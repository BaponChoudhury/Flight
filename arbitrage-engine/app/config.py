"""Runtime configuration, read once from environment variables (prefix ``ARB_``)."""

from __future__ import annotations

import os
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class Settings(BaseModel):
    """Every tunable of the engine. Money and rates are ``Decimal`` — never ``float``."""

    model_config = ConfigDict(frozen=True)

    # Upstream endpoints. By default they point at the mock providers mounted on this
    # same app under /mock, so the MVP runs end to end with no external keys.
    upstream_base_url: str = "http://127.0.0.1:8000"
    flight_search_path: str = "/mock/flights/search"
    wise_rates_path: str = "/mock/wise/v1/rates"
    rail_search_path: str = "/mock/rail/journeys"
    webhook_url: str = "http://127.0.0.1:8000/mock/webhook"
    wise_api_token: str | None = None

    database_path: str = "arbitrage.db"

    home_market: str = "GB"
    home_currency: str = "GBP"

    # Ledger parameters.
    wise_fee_rate: Decimal = Field(default=Decimal("0.004"), ge=0, lt=1)  # Wise conversion fee (0.4%)
    fx_buffer_rate: Decimal = Field(default=Decimal("0.005"), ge=0, lt=1)  # rate-move reserve between quote and manual booking
    platform_fee_rate: Decimal = Field(default=Decimal("0.03"), ge=0, lt=1)
    platform_fee_min_gbp: Decimal = Field(default=Decimal("5.00"), ge=0)
    min_net_profit_gbp: Decimal = Field(default=Decimal("1.00"), ge=0)

    # Behaviour.
    request_timeout_s: float = Field(default=8.0, gt=0)
    fx_cache_ttl_s: float = Field(default=30.0, ge=0)
    offer_ttl_s: int = Field(default=900, gt=0)
    rail_max_miles: float = Field(default=400.0, gt=0)
    airport_overhead_min: int = Field(default=120, ge=0)  # security / check-in added to flights
    rail_overhead_min: int = Field(default=30, ge=0)  # e.g. Eurostar check-in
    webhook_retries: int = Field(default=2, ge=0)

    # Test hook for the mock flight API: markets listed here answer HTTP 503.
    mock_fail_markets: frozenset[str] = frozenset()


def load_settings() -> Settings:
    """Build settings from ``ARB_*`` environment variables, falling back to defaults."""
    overrides: dict[str, object] = {}
    for name in Settings.model_fields:
        raw = os.environ.get(f"ARB_{name.upper()}")
        if raw is None:
            continue
        overrides[name] = frozenset(m.strip().upper() for m in raw.split(",") if m.strip()) if name == "mock_fail_markets" else raw
    return Settings.model_validate(overrides)
