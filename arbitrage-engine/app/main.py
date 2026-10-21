"""FastAPI application: multi-POS search with swap-to-train, and the human-in-the-loop checkout.

Run:  uvicorn app.main:app --reload
Docs: http://127.0.0.1:8000/docs
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app import mock_providers
from app.config import Settings, load_settings
from app.db import Database
from app.schemas import CheckoutRequest, CheckoutResponse, SearchQuery, SearchResponse
from app.services import (
    AdminNotifier,
    CheckoutService,
    DomainError,
    FlightService,
    RailInterlineInterceptor,
    RailService,
    SearchOrchestrator,
    WiseFintechService,
)

logger = logging.getLogger("arbitrage")


def create_app(settings: Settings | None = None, upstream_transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    """Build the app. ``upstream_transport`` lets tests route upstream calls in-process."""
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        db = Database(settings.database_path)
        await db.connect()
        client = httpx.AsyncClient(
            base_url=settings.upstream_base_url,
            timeout=httpx.Timeout(settings.request_timeout_s),
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
            transport=upstream_transport,
            headers={"User-Agent": "arbitrage-engine/0.1"},
        )
        wise = WiseFintechService(client, settings)
        flights = FlightService(client, settings, wise)
        interceptor = RailInterlineInterceptor(RailService(client, settings, wise), settings)
        app.state.orchestrator = SearchOrchestrator(flights, interceptor, db, settings)
        app.state.checkout = CheckoutService(db, wise, AdminNotifier(client, settings), settings)
        app.state.db = db
        logger.info("Engine ready (upstreams at %s)", settings.upstream_base_url)
        try:
            yield
        finally:
            await client.aclose()
            await db.close()

    app = FastAPI(
        title="Flight, Rail & FX Arbitrage Engine (MVP)",
        version="0.1.0",
        description="Multi point-of-sale fare search with Wise mid-market conversion, swap-to-train, and a human-in-the-loop checkout ledger.",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.webhook_inbox = []
    app.state.webhook_fail = False
    app.include_router(mock_providers.router)

    @app.middleware("http")
    async def request_id(request: Request, call_next: Any) -> Any:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        return response

    @app.exception_handler(DomainError)
    async def domain_error(request: Request, exc: DomainError) -> JSONResponse:
        logger.info("%s %s -> %s: %s", request.method, request.url.path, exc.code, exc.message)
        return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "detail": exc.message, "request_id": getattr(request.state, "request_id", None)})

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"error": "internal_error", "detail": "unexpected server error", "request_id": getattr(request.state, "request_id", None)})

    @app.get("/healthz", tags=["ops"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/search", response_model=SearchResponse, tags=["search"])
    async def search(query: SearchQuery, request: Request) -> SearchResponse:
        """Query the domestic, destination and carrier-hub points of sale concurrently, convert every
        fare to GBP at the Wise mid-market rate, and surface the cheapest. Short rail-connected hops
        also get a concurrent rail check; a faster or cheaper train comes back as ``train_alternative``."""
        orchestrator: SearchOrchestrator = request.app.state.orchestrator
        return await orchestrator.search(query)

    @app.post("/api/checkout", response_model=CheckoutResponse, status_code=201, tags=["checkout"])
    async def checkout(body: CheckoutRequest, request: Request) -> CheckoutResponse:
        """Re-price the held offer at the live Wise rate, book the ledger, store the order and notify
        the booking desk. Idempotent on ``payment.payment_reference``."""
        service: CheckoutService = request.app.state.checkout
        return await service.checkout(body)

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
