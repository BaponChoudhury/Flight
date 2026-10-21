from __future__ import annotations

from decimal import Decimal
from typing import Any

import httpx

from tests.conftest import FUTURE

PAX = [
    {"title": "MR", "first_name": "Arjun", "last_name": "Das", "date_of_birth": "1985-04-12", "nationality": "GB", "passport_number": "123456789"},
    {"title": "MRS", "first_name": "Mira", "last_name": "Das", "date_of_birth": "1987-09-30", "nationality": "GB", "passport_number": "987654321"},
]


async def _cheapest(client: httpx.AsyncClient, **query: Any) -> dict[str, Any]:
    r = await client.post("/api/search", json={"origin": "LHR", "destination": "DEL", "departure_date": FUTURE, "adults": 2, **query})
    return r.json()["cheapest"]


def _body(fare: dict[str, Any], ref: str = "pay_abc123", amount: str | None = None, pax: list[dict[str, Any]] = PAX) -> dict[str, Any]:
    return {
        "offer_id": fare["offer_id"],
        "contact": {"email": "Arjun@Example.com", "phone": "+447700900123"},
        "passengers": pax,
        "payment": {"amount_gbp": amount or fare["checkout_price_gbp"], "currency": "GBP", "payment_reference": ref},
    }


async def test_checkout_books_ledger_stores_order_and_notifies(client: httpx.AsyncClient) -> None:
    fare = await _cheapest(client)
    r = await client.post("/api/checkout", json=_body(fare))
    assert r.status_code == 201, r.text
    out = r.json()
    ledger, instr = out["ledger"], out["booking_instructions"]

    assert out["status"] == "pending_manual_booking" and out["idempotent_replay"] is False
    assert ledger["target_currency"] == "INR" and ledger["target_amount"] == fare["price_local"]["amount"]
    assert Decimal(ledger["funded_target_amount"]) >= Decimal(ledger["target_amount"])
    assert Decimal(ledger["wise_debit_gbp"]) == Decimal(ledger["gbp_converted"]) + Decimal(ledger["wise_fee_gbp"])
    assert Decimal(ledger["net_profit_gbp"]) == Decimal(ledger["customer_paid_gbp"]) - Decimal(ledger["wise_debit_gbp"]) - Decimal(ledger["fx_buffer_gbp"])
    assert Decimal(ledger["net_profit_gbp"]) >= Decimal("1.00")
    assert instr["vpn_node"] == "in-bom-01 (Mumbai)" and instr["pay_airline_amount"]["currency"] == "INR"
    assert out["notification"] == {"delivered": True, "attempts": 1, "error": None}

    inbox = client.app.state.webhook_inbox  # type: ignore[attr-defined]
    assert len(inbox) == 1
    msg = inbox[0]
    assert "in-bom-01" in msg["text"] and fare["price_local"]["amount"] in msg["text"]
    assert msg["order"]["target_amount"] == fare["price_local"]["amount"]
    assert "123456789" not in str(msg)  # passports stay out of chat

    stored = await client.app.state.db.get_order(out["order_id"])  # type: ignore[attr-defined]
    assert stored["passengers"][0]["passport_number"] == "123456789"
    assert stored["contact"]["email"] == "arjun@example.com"
    assert stored["notification"]["delivered"] is True


async def test_idempotent_on_payment_reference(client: httpx.AsyncClient) -> None:
    fare = await _cheapest(client)
    first = (await client.post("/api/checkout", json=_body(fare, ref="pay_same_1"))).json()
    again = await client.post("/api/checkout", json=_body(fare, ref="pay_same_1"))
    assert again.json()["order_id"] == first["order_id"] and again.json()["idempotent_replay"] is True
    assert len(client.app.state.webhook_inbox) == 1  # type: ignore[attr-defined]
    other = (await client.post("/api/search", json={"origin": "LHR", "destination": "BOM", "departure_date": FUTURE, "adults": 2})).json()["cheapest"]
    clash = await client.post("/api/checkout", json=_body(other, ref="pay_same_1"))
    assert clash.status_code == 409 and clash.json()["error"] == "payment_reference_conflict"


async def test_rejects_underpayment_wrong_pax_and_unknown_offer(client: httpx.AsyncClient) -> None:
    fare = await _cheapest(client)
    under = str(Decimal(fare["checkout_price_gbp"]) - Decimal("0.01"))
    r = await client.post("/api/checkout", json=_body(fare, ref="pay_under_1", amount=under))
    assert r.status_code == 422 and "below the quoted" in r.json()["detail"]
    r = await client.post("/api/checkout", json=_body(fare, ref="pay_pax_1", pax=PAX[:1]))
    assert r.status_code == 422 and "2 passenger" in r.json()["detail"]
    r = await client.post("/api/checkout", json=_body({**fare, "offer_id": "IN-doesnotexist"}, ref="pay_none_1"))
    assert r.status_code == 404
    bad_pax = [{**PAX[0], "date_of_birth": "2022-01-01"}, PAX[1]]
    assert (await client.post("/api/checkout", json=_body(fare, ref="pay_kid_1", pax=bad_pax))).status_code == 422


async def test_rate_move_that_kills_the_margin_forces_a_requote(client: httpx.AsyncClient, monkeypatch: Any) -> None:
    fare = await _cheapest(client)
    from app import mock_providers

    monkeypatch.setitem(mock_providers.MOCK_GBP_RATES, "INR", Decimal("95"))  # GBP weakens ~12%
    r = await client.post("/api/checkout", json=_body(fare, ref="pay_move_1"))
    assert r.status_code == 409 and r.json()["error"] == "requote_required"
    assert client.app.state.webhook_inbox == []  # type: ignore[attr-defined]


async def test_webhook_failure_is_recorded_not_fatal(client: httpx.AsyncClient) -> None:
    fare = await _cheapest(client)
    client.app.state.webhook_fail = True  # type: ignore[attr-defined]
    r = await client.post("/api/checkout", json=_body(fare, ref="pay_hook_1"))
    assert r.status_code == 201
    assert r.json()["notification"] == {"delivered": False, "attempts": 3, "error": "HTTP 502"}
