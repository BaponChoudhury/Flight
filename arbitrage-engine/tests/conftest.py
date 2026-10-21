from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.main import create_app

FUTURE = "2026-12-10"


def make_settings(tmp_path: Any, **overrides: Any) -> Settings:
    return Settings(database_path=str(tmp_path / "test.db"), upstream_base_url="http://upstream", webhook_url="http://upstream/mock/webhook", **overrides)


@pytest.fixture
def app_factory(tmp_path: Any) -> Callable[..., Any]:
    def build(**overrides: Any) -> Any:
        holder: dict[str, Any] = {}

        async def asgi(scope: Any, receive: Any, send: Any) -> None:  # upstream calls loop back into the mocks
            await holder["app"](scope, receive, send)

        app = create_app(make_settings(tmp_path, **overrides), upstream_transport=httpx.ASGITransport(app=asgi))
        holder["app"] = app
        return app

    return build


@pytest.fixture
async def client(app_factory: Callable[..., Any]) -> AsyncIterator[httpx.AsyncClient]:
    app = app_factory()
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            c.app = app  # type: ignore[attr-defined]
            yield c
