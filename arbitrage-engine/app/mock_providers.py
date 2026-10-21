"""Mock upstream providers, mounted under ``/mock`` on the same app.

They stand in for the real integrations so the MVP is runnable with zero keys:

- ``POST /mock/flights/search``  — a fare API queried per point of sale (Ignav-like).
- ``GET  /mock/wise/v1/rates``   — Wise mid-market rates, same shape as Wise's ``/v1/rates``.
- ``POST /mock/rail/journeys``   — high-speed rail (Eurostar / DB / SNCF-style open data).
- ``POST /mock/webhook``         — admin/Slack notification inbox.

Prices are deterministic per (route, date, market) so tests are stable; FX drifts
slightly over time so the "live" rate path is exercised.
"""

from __future__ import annotations

import hashlib
import logging
import math
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from app.reference import AIRPORTS, AIRLINE_HOME_COUNTRY, FLAG_CARRIER, HUB_CARRIER_FALLBACKS, ceil_to_minor, haversine_miles

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/mock", tags=["mock upstreams"])

# Baseline mid-market rates: units of currency per 1 GBP.
MOCK_GBP_RATES: dict[str, Decimal] = {
    "GBP": Decimal("1"), "EUR": Decimal("1.1712"), "INR": Decimal("108.47"), "AED": Decimal("4.6630"),
    "QAR": Decimal("4.6215"), "TRY": Decimal("43.812"), "USD": Decimal("1.2697"), "JPY": Decimal("192.38"),
}

# How a market's fares compare to the UK point of sale for the same flights.
MARKET_PRICE_FACTOR: dict[str, Decimal] = {
    "GB": Decimal("1.00"), "FR": Decimal("0.97"), "NL": Decimal("0.96"), "BE": Decimal("0.98"),
    "DE": Decimal("0.99"), "IN": Decimal("0.84"), "AE": Decimal("0.91"), "QA": Decimal("0.93"),
    "TR": Decimal("0.88"), "US": Decimal("1.04"), "JP": Decimal("1.02"),
}


def _jitter(*parts: str, spread: float = 0.03) -> Decimal:
    """Deterministic factor in [1 - spread, 1 + spread] derived from the inputs."""
    digest = hashlib.sha256("|".join(parts).encode()).digest()
    unit = int.from_bytes(digest[:4], "big") / 0xFFFFFFFF
    return Decimal(str(round(1 - spread + 2 * spread * unit, 4)))


# ---------------------------------------------------------------------------
# Flights
# ---------------------------------------------------------------------------


class MockFlightRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: str
    destination: str
    departure_date: date
    market: str
    currency: str
    adults: int = Field(ge=1, le=9)


@router.post("/flights/search")
async def mock_flight_search(body: MockFlightRequest, request: Request) -> dict[str, Any]:
    settings = request.app.state.settings
    if body.market in settings.mock_fail_markets:
        raise HTTPException(status_code=503, detail=f"POS node {body.market} unavailable")
    a, b = AIRPORTS.get(body.origin), AIRPORTS.get(body.destination)
    if not a or not b:
        return {"market": body.market, "currency": body.currency, "offers": []}
    rate = MOCK_GBP_RATES.get(body.currency)
    if rate is None:
        raise HTTPException(status_code=400, detail=f"currency {body.currency} not supported")

    miles = haversine_miles(a, b)
    base_gbp = (Decimal("45") + Decimal(str(miles)) * Decimal("0.085")) * body.adults
    factor = MARKET_PRICE_FACTOR.get(body.market, Decimal("1"))
    direct_minutes = int(miles / 480 * 60 + 25)
    day = datetime.combine(body.departure_date, datetime.min.time(), tzinfo=timezone.utc)

    main = FLAG_CARRIER.get(b.country) or FLAG_CARRIER.get(a.country) or "BA"
    hub = next((c for c in HUB_CARRIER_FALLBACKS if AIRLINE_HOME_COUNTRY[c] not in (a.country, b.country)), "LH")
    offers = []
    for idx, (carrier, stops, price_factor, minutes, dep_hour) in enumerate(
        ((main, 0, Decimal("1.00"), direct_minutes, 9.5), (hub, 1, Decimal("0.93"), direct_minutes + 185, 13.75))
    ):
        key = (body.origin, body.destination, body.departure_date.isoformat(), body.market, carrier)
        gbp = base_gbp * factor * price_factor * _jitter(*key)
        depart = day + timedelta(hours=dep_hour)
        offers.append(
            {
                "offer_ref": hashlib.sha1("|".join(key).encode()).hexdigest()[:16],
                "carrier": carrier,
                "flight_numbers": [f"{carrier}{100 + idx * 7 + n}" for n in range(stops + 1)],
                "depart_at": depart.isoformat(),
                "arrive_at": (depart + timedelta(minutes=minutes)).isoformat(),
                "duration_minutes": minutes,
                "stops": stops,
                "price": {"amount": str(ceil_to_minor(gbp * rate, body.currency)), "currency": body.currency},
            }
        )
    return {"market": body.market, "currency": body.currency, "offers": offers}


# ---------------------------------------------------------------------------
# Wise mid-market rates
# ---------------------------------------------------------------------------


@router.get("/wise/v1/rates")
async def mock_wise_rates(source: str = Query(min_length=3, max_length=3), target: str = Query(min_length=3, max_length=3)) -> list[dict[str, Any]]:
    source, target = source.upper(), target.upper()
    if source not in MOCK_GBP_RATES or target not in MOCK_GBP_RATES:
        raise HTTPException(status_code=400, detail={"errors": [{"code": "error.unsupported.currency", "message": f"{source}->{target}"}]})
    # Small, slow drift (±0.15%) so the live path is genuinely live.
    drift = Decimal(str(round(1 + 0.0015 * math.sin(time.time() / 420), 6)))
    rate = (MOCK_GBP_RATES[target] / MOCK_GBP_RATES[source]) * (drift if source != target else 1)
    return [{"rate": float(round(rate, 6)), "source": source, "target": target, "time": datetime.now(timezone.utc).isoformat()}]


# ---------------------------------------------------------------------------
# Rail
# ---------------------------------------------------------------------------

_RAIL_LINKS: dict[frozenset[str], tuple[str, int, Decimal, Decimal]] = {
    # (operator, minutes, price from London in GBP, price from mainland in EUR) per adult
    frozenset({"London St Pancras International", "Paris Gare du Nord"}): ("Eurostar", 136, Decimal("78"), Decimal("91")),
    frozenset({"London St Pancras International", "Bruxelles-Midi"}): ("Eurostar", 121, Decimal("72"), Decimal("84")),
    frozenset({"London St Pancras International", "Amsterdam Centraal"}): ("Eurostar", 236, Decimal("86"), Decimal("99")),
    frozenset({"Paris Gare du Nord", "Bruxelles-Midi"}): ("Eurostar", 82, Decimal("55"), Decimal("65")),
    frozenset({"Paris Gare du Nord", "Amsterdam Centraal"}): ("Eurostar", 200, Decimal("76"), Decimal("89")),
    frozenset({"Bruxelles-Midi", "Amsterdam Centraal"}): ("Eurostar", 112, Decimal("38"), Decimal("45")),
    frozenset({"Frankfurt (Main) Hbf", "Köln Hbf"}): ("DB ICE", 62, Decimal("33"), Decimal("39")),
    frozenset({"Paris Gare du Nord", "Frankfurt (Main) Hbf"}): ("SNCF TGV INOUI", 230, Decimal("67"), Decimal("79")),
    frozenset({"Bruxelles-Midi", "Frankfurt (Main) Hbf"}): ("DB ICE", 180, Decimal("59"), Decimal("69")),
}


class MockRailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin_station: str
    destination_station: str
    date: date
    adults: int = Field(ge=1, le=9)


@router.post("/rail/journeys")
async def mock_rail_journeys(body: MockRailRequest) -> dict[str, Any]:
    link = _RAIL_LINKS.get(frozenset({body.origin_station, body.destination_station}))
    if link is None:
        return {"journeys": []}
    operator, minutes, gbp, eur = link
    from_london = body.origin_station.startswith("London")
    currency, unit = ("GBP", gbp) if from_london else ("EUR", eur)
    day = datetime.combine(body.date, datetime.min.time(), tzinfo=timezone.utc)
    journeys = []
    for n, (hour, factor) in enumerate(((7.0, Decimal("1.00")), (11.5, Decimal("0.92")), (17.0, Decimal("1.18")))):
        depart = day + timedelta(hours=hour)
        price = unit * factor * _jitter(body.origin_station, body.destination_station, body.date.isoformat(), str(n), spread=0.05) * body.adults
        journeys.append(
            {
                "operator": operator,
                "train_number": f"{operator.split()[0][:3].upper()}{9000 + n * 14}",
                "depart_at": depart.isoformat(),
                "arrive_at": (depart + timedelta(minutes=minutes)).isoformat(),
                "duration_minutes": minutes,
                "price": {"amount": str(ceil_to_minor(price, currency)), "currency": currency},
            }
        )
    return {"journeys": journeys}


# ---------------------------------------------------------------------------
# Webhook inbox
# ---------------------------------------------------------------------------


@router.post("/webhook")
async def mock_webhook(request: Request) -> dict[str, bool]:
    if getattr(request.app.state, "webhook_fail", False):
        raise HTTPException(status_code=502, detail="webhook receiver down")
    payload = await request.json()
    inbox: list[dict[str, Any]] = request.app.state.webhook_inbox
    inbox.append(payload)
    logger.info("Admin webhook received: %s", payload.get("text", "")[:120])
    return {"ok": True}
