"""Ledger maths: the airline is never under-funded and profit is never overstated."""

from __future__ import annotations

import random
from decimal import Decimal

import httpx
import pytest

from app.config import Settings
from app.reference import floor_to_minor
from app.services import WiseFintechService


@pytest.fixture
def wise() -> WiseFintechService:
    return WiseFintechService(httpx.AsyncClient(), Settings())


def test_worked_example(wise: WiseFintechService) -> None:
    # Pay an airline ₹70,000 at 108.47 INR/GBP with a 0.4% Wise fee.
    d = wise.size_debit(Decimal("70000"), "INR", Decimal("108.47"))
    # Analytic answer: 70000 / (108.47 × 0.996) = 647.9097… → ceil 647.92. But Wise rounds its
    # fee UP (0.4% × 647.92 = 2.59168 → 2.60), leaving 645.32 → ₹69,997.86: ₹2.14 SHORT.
    # The penny step-up finds the true minimum debit:
    assert d.debit_gbp == Decimal("647.94")
    assert d.fee_gbp == Decimal("2.60")  # 0.4% of 647.94 = 2.59176 → 2.60
    assert d.converted_gbp == Decimal("645.34")
    assert d.funded_target == Decimal("70000.02")  # 645.34 × 108.47 = 70000.0298 → truncated
    ledger = wise.build_ledger(target_amount=Decimal("70000"), currency="INR", mid_rate=Decimal("108.47"), customer_paid_gbp=Decimal("690.00"))
    assert ledger.rounding_overfund == Decimal("0.02")  # stays in the INR balance
    assert ledger.fx_buffer_gbp == Decimal("3.24")  # 0.5% of 647.94 = 3.2397 → 3.24
    assert ledger.gross_margin_gbp == Decimal("42.06")
    assert ledger.net_profit_gbp == Decimal("38.82")
    assert ledger.net_margin_pct == Decimal("5.62")  # 5.6260… floored


@pytest.mark.parametrize("currency", ["INR", "EUR", "AED", "JPY", "TRY"])
def test_never_underfunds_the_airline(wise: WiseFintechService, currency: str) -> None:
    rng = random.Random(42)
    for _ in range(2000):
        rate = Decimal(str(round(rng.uniform(0.5, 250), 4)))
        target = floor_to_minor(Decimal(str(rng.uniform(1, 500_000))), currency) or Decimal(1)
        d = wise.size_debit(target, currency, rate)
        # What Wise actually delivers, truncated to the minor unit, covers the target …
        delivered = floor_to_minor((d.debit_gbp - d.fee_gbp) * rate, currency)
        assert delivered >= target
        # … and the debit is the minimum: one penny less would not.
        less = d.debit_gbp - Decimal("0.01")
        fee_less = (less * wise.fee_rate_for(currency)).quantize(Decimal("0.01"), rounding="ROUND_CEILING")
        assert floor_to_minor((less - fee_less) * rate, currency) < target


def test_home_currency_has_no_fee_or_buffer(wise: WiseFintechService) -> None:
    d = wise.size_debit(Decimal("412.37"), "GBP", Decimal(1))
    assert (d.debit_gbp, d.fee_gbp, d.funded_target) == (Decimal("412.37"), Decimal("0.00"), Decimal("412.37"))
    ledger = wise.build_ledger(target_amount=Decimal("412.37"), currency="GBP", mid_rate=Decimal(1), customer_paid_gbp=Decimal("425.00"))
    assert ledger.fx_buffer_gbp == Decimal("0.00")
    assert ledger.net_profit_gbp == Decimal("12.63")


def test_quote_covers_costs_with_at_least_the_minimum_fee(wise: WiseFintechService) -> None:
    debit, price = wise.quote_checkout_price(Decimal("90.00"), "EUR", Decimal("1.1712"))
    ledger = wise.build_ledger(target_amount=Decimal("90.00"), currency="EUR", mid_rate=Decimal("1.1712"), customer_paid_gbp=price)
    assert ledger.net_profit_gbp >= Decimal("5.00")  # platform minimum fee survives fee + reserve
    assert price > debit.debit_gbp


def test_negative_margin_is_reported_not_hidden(wise: WiseFintechService) -> None:
    ledger = wise.build_ledger(target_amount=Decimal("1000"), currency="EUR", mid_rate=Decimal("1.10"), customer_paid_gbp=Decimal("900"))
    assert ledger.net_profit_gbp < 0
