from __future__ import annotations

from decimal import Decimal

import httpx

from tests.conftest import FUTURE


async def test_three_pos_nodes_and_cheapest_is_tagged(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/search", json={"origin": "lhr", "destination": "DEL", "departure_date": FUTURE, "adults": 2})
    assert r.status_code == 200, r.text
    body = r.json()
    nodes = {(p["pos"]["role"], p["pos"]["market"], p["pos"]["currency"]) for p in body["pos_results"]}
    assert nodes == {("domestic", "GB", "GBP"), ("destination", "IN", "INR"), ("carrier_hub", "AE", "AED")}
    assert all(p["status"] == "ok" for p in body["pos_results"])
    fares = body["fares"]
    assert {f["price_local"]["currency"] for f in fares} == {"GBP", "INR", "AED"}
    prices = [Decimal(f["checkout_price_gbp"]) for f in fares]
    assert prices == sorted(prices)
    cheapest = body["cheapest"]
    assert cheapest == fares[0]
    assert body["cheapest_pos_role"] == cheapest["pos"]["role"] == "destination"  # India POS is cheapest in the mock
    assert Decimal(body["saving_vs_domestic_gbp"]) > 0
    assert Decimal(cheapest["saving_vs_domestic_gbp"]) > 0
    # Foreign fares carry the Wise fee in landed cost; GBP fares don't.
    for f in fares:
        if f["price_local"]["currency"] == "GBP":
            assert f["landed_cost_gbp"] == f["price_local"]["amount"]
        else:
            assert Decimal(f["landed_cost_gbp"]) > Decimal(f["price_gbp_mid"])
    assert body["rail_checked"] is False and body["train_alternative"] is None


async def test_carrier_hint_selects_the_hub_market(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/search", json={"origin": "LHR", "destination": "DEL", "departure_date": FUTURE, "carrier": "TK"})
    hub = next(p["pos"] for p in r.json()["pos_results"] if p["pos"]["role"] == "carrier_hub")
    assert (hub["market"], hub["currency"], hub["carrier_basis"]) == ("TR", "TRY", "TK")


async def test_one_pos_failing_still_returns_results(app_factory) -> None:  # type: ignore[no-untyped-def]
    app = app_factory(mock_fail_markets=frozenset({"IN"}))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post("/api/search", json={"origin": "LHR", "destination": "DEL", "departure_date": FUTURE})
    body = r.json()
    failed = [p for p in body["pos_results"] if p["status"] == "error"]
    assert [(p["pos"]["market"], p["error"]) for p in failed] == [("IN", "HTTP 503")]
    assert body["cheapest"]["pos"]["market"] != "IN"


async def test_all_pos_failing_is_a_502(app_factory) -> None:  # type: ignore[no-untyped-def]
    app = app_factory(mock_fail_markets=frozenset({"GB", "IN", "AE"}))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post("/api/search", json={"origin": "LHR", "destination": "DEL", "departure_date": FUTURE})
    assert r.status_code == 502
    assert r.json()["error"] == "all_pos_nodes_failed"


async def test_swap_to_train_for_london_paris(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/search", json={"origin": "LHR", "destination": "CDG", "departure_date": FUTURE})
    body = r.json()
    assert body["rail_checked"] is True and body["distance_miles"] < 400
    alt = body["train_alternative"]
    assert alt is not None and alt["priority"] == "prioritized"
    assert alt["rail"]["operator"] == "Eurostar"
    assert alt["flight_door_to_door_minutes"] == body["cheapest"]["duration_minutes"] + 120
    assert alt["rail_door_to_door_minutes"] == alt["rail"]["duration_minutes"] + 30
    assert "faster" in alt["reasons"]
    assert alt["time_saved_minutes"] == alt["flight_door_to_door_minutes"] - alt["rail_door_to_door_minutes"]
    assert list(body).index("train_alternative") < list(body).index("cheapest")  # prioritised in the payload


async def test_no_rail_for_long_haul_or_unconnected_airports(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/search", json={"origin": "MAN", "destination": "CDG", "departure_date": FUTURE})
    assert r.json()["rail_checked"] is False  # Manchester has no high-speed rail link in the router


async def test_validation(client: httpx.AsyncClient) -> None:
    bad = [
        {"origin": "LHR", "destination": "LHR", "departure_date": FUTURE},
        {"origin": "LONDON", "destination": "DEL", "departure_date": FUTURE},
        {"origin": "LHR", "destination": "DEL", "departure_date": "2020-01-01"},
        {"origin": "LHR", "destination": "DEL", "departure_date": FUTURE, "adults": 0},
        {"origin": "LHR", "destination": "DEL", "departure_date": FUTURE, "surprise": 1},
    ]
    for payload in bad:
        assert (await client.post("/api/search", json=payload)).status_code == 422, payload
    r = await client.post("/api/search", json={"origin": "LHR", "destination": "XXX", "departure_date": FUTURE})
    assert r.status_code == 422 and r.json()["error"] == "unsupported_route"
