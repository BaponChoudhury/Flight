# Flight, Rail & FX Arbitrage Engine (MVP)

An async FastAPI service that:

1. **Searches several points of sale (POS) at once.** The same flights are priced through the UK market, the destination's market, and the carrier's home market. Every price is converted to GBP at the Wise mid-market rate, and the cheapest is surfaced, tagged with the POS that won.
2. **Swaps to train** on short European hops (under 400 miles between rail-connected hubs) when rail is faster door-to-door or cheaper.
3. **Runs a human-in-the-loop checkout.** It re-prices the held offer at the live Wise rate, books a penny-exact ledger, stores the order in SQLite, and pings the booking desk with what to pay, in which currency, through which VPN node.

All upstreams are mocked and mounted on the same app under `/mock`, so it runs end to end with no keys. Point the `ARB_*_PATH` / `ARB_UPSTREAM_BASE_URL` settings at real services when they exist.

## Run

```bash
cd arbitrage-engine
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --port 8000        # docs: http://127.0.0.1:8000/docs
pytest                                  # 21 tests, all in-process
```

```bash
curl -s -X POST localhost:8000/api/search -H 'content-type: application/json' \
  -d '{"origin":"LHR","destination":"DEL","departure_date":"2026-12-10","adults":2}'
```

## Layout

| File | Purpose |
|---|---|
| `app/schemas.py` | Pydantic V2 contracts (`SearchQuery`, `FlightFare`, `RailFare`, `CheckoutRequest`, `LedgerBreakdown`, …). `extra="forbid"`; money is `Decimal` and serialises as a JSON string. |
| `app/services.py` | `WiseFintechService` (rates and ledger), `FlightService` (multi-POS), `RailService` and `RailInterlineInterceptor`, `SearchOrchestrator`, `CheckoutService`, `AdminNotifier`. |
| `app/main.py` | App factory, lifespan (one shared `httpx.AsyncClient`, SQLite), routes, error mapping, request IDs. |
| `app/db.py` | aiosqlite store: `offers` (server-held prices) and `orders` (`payment_reference` UNIQUE, which makes checkout idempotent). |
| `app/reference.py` | Airports, currencies (incl. minor units), carriers, rail stations, VPN nodes, haversine. |
| `app/mock_providers.py` | Mock flight POS API, Wise `/v1/rates`, rail journeys, webhook inbox. |
| `app/config.py` | `Settings`, read from `ARB_*` environment variables. |

## `POST /api/search`

- **POS nodes:**
  - `domestic`: GB / GBP.
  - `destination`: destination country and its currency.
  - `carrier_hub`: home market of the carrier you hint with `carrier`. Without a hint, it uses the first of: the destination's flag carrier, the origin's flag carrier, then EK / QR / TK / LH whose market isn't already used. For LHR → DEL that's IN for the destination and AE (Emirates) for the hub.
- **Concurrency:** the three fare requests run with `asyncio.gather`. Each one fetches its fare and its Wise rate concurrently. Rates are cached for 30s, and concurrent requests for the same currency pair share one call. A failed node is reported in `pos_results` and doesn't sink the search. Only all three failing returns `502`.
- **Comparison basis:** `checkout_price_gbp` is what the customer would actually pay: landed cost after Wise's fee, plus the FX reserve, plus the platform fee. That's the honest number, rather than the mid-market price. Each fare also shows `saving_vs_domestic_gbp`, compared with the same flights bought through the UK POS.
- **Swap-to-train:** when the route is under `ARB_RAIL_MAX_MILES` (400) and both airports have a high-speed station, the rail lookup runs concurrently with the flight searches. Flight door-to-door = duration + 120 min; rail = duration + 30 min check-in. A journey that's faster and/or cheaper is returned as `train_alternative` (first in the payload, with `priority: "prioritized"`) and tagged with `reasons`.
- **Offers are stored server-side** (`offers` table, 15-minute TTL). Checkout only takes an `offer_id` and never trusts a price sent by the client.

## `POST /api/checkout`

1. **Idempotency:** a repeated `payment_reference` returns the original order (`idempotent_replay: true`). The same reference used for a different offer returns `409`.
2. **Checks:** the offer must exist (`404`) and not have expired (`410`). The passenger count must match the priced count, and the payment must be at least the quoted price (`422`).
3. **Live re-price:** the Wise rate is fetched again, bypassing the cache, and the ledger is built from it. If the rate has moved enough that net profit falls below `ARB_MIN_NET_PROFIT_GBP` (£1), it returns `409 requote_required` and **no order is created**.
4. **Storage:** the order is saved with passengers, contact, ledger and booking instructions.
5. **Webhook:** a Slack-style message is sent with retries (exponential backoff). It names the flights, the exact foreign amount, the Wise balance to pay from and the VPN node. Passport numbers stay in the database, not in chat. A failed webhook is recorded on the order and returned in `notification`, but doesn't fail the checkout.

## How the ledger protects the margin, to the penny

Wise converts `debit − fee`, where `fee = 0.4% × debit`. The foreign amount you receive is truncated to that currency's smallest unit. Solving `debit = target / (rate × (1 − 0.004))` and rounding to the penny is **not enough**, because Wise also rounds its fee. Worked example (`tests/test_ledger.py`):

| Step | Value |
|---|---|
| Airline wants | ₹70,000.00 |
| Mid-market | 108.47 INR/GBP |
| Analytic debit | 70,000 / (108.47 × 0.996) = £647.9097 → **£647.92** |
| Wise fee on £647.92 | 0.4% = £2.59168 → **£2.60** |
| Converted | £645.32 × 108.47 = ₹69,997.86 → **₹2.14 short**, so the airline payment would fail |
| Engine steps up a penny at a time | **£647.94** → fee £2.60 → £645.34 → **₹70,000.02** ✓ |

The rules `WiseFintechService` follows:

- **Pay-side amounts round up:** the airline amount (in its minor unit, so JPY has 0 decimals), the Wise debit, the Wise fee, the FX reserve and the platform fee. The debit is the *smallest* whole-penny amount that fully funds the airline. A test checks this against 10,000 random amounts and rates in 5 currencies.
- **Our-side amounts round down:** gross margin, net profit and margin %. Profit is never overstated by a fraction of a penny.
- **Over-funding is visible:** `rounding_overfund` (e.g. ₹0.02) shows the foreign pennies left over. They stay in the Wise INR balance and are not counted as profit.
- **FX reserve:** `fx_buffer_gbp` (0.5% of the debit) is held back from profit, because a human books the ticket minutes or hours later and the rate can move. GBP fares have no FX exposure, so no reserve and no Wise fee.
- **Live re-price at checkout:** if the rate has moved enough to wipe out the margin, the engine refuses the order (`409`) instead of quietly losing money.
- **No floats:** `Decimal` is used throughout, with 34-digit precision for the division. Mock or real rates arriving as JSON floats are converted via `str` before any maths.

The ledger fields are `customer_paid_gbp`, `wise_debit_gbp = gbp_converted + wise_fee_gbp`, `target_amount`, `funded_target_amount`, `rounding_overfund`, `fx_buffer_gbp`, `gross_margin_gbp = paid − debit`, and `net_profit_gbp = gross − buffer`.

## Before taking real money

These are commercial and legal checks for the business model, not code problems:

- **ATOL:** in the UK, taking a customer's money for flights *before* the ticket is issued, which is what the manual booking step does, generally needs ATOL protection. Get advice before you take live payments.
- **Airline fare rules and VPN use:** buying through a foreign point of sale can breach a fare's point-of-sale or residency rules or an airline's terms. Airlines can then cancel or reprice the ticket, and the passenger bears that risk. Check each carrier's conditions, and tell customers.
- **Wise Business:** confirm that paying airlines from currency balances on customers' behalf fits Wise's acceptable-use terms for your account type.
- **Data:** passport numbers and dates of birth are stored as plain text in SQLite in this MVP. Encrypt them at rest and limit retention before going live. Card payments belong with a PCI-compliant processor (e.g. Stripe), not in this service. `payment_reference` is designed to be that processor's payment ID.

## Configuration (`ARB_*`)

`ARB_UPSTREAM_BASE_URL`, `ARB_FLIGHT_SEARCH_PATH`, `ARB_WISE_RATES_PATH`, `ARB_RAIL_SEARCH_PATH`, `ARB_WEBHOOK_URL`, `ARB_WISE_API_TOKEN`, `ARB_DATABASE_PATH`, `ARB_WISE_FEE_RATE` (0.004), `ARB_FX_BUFFER_RATE` (0.005), `ARB_PLATFORM_FEE_RATE` (0.03), `ARB_PLATFORM_FEE_MIN_GBP` (5.00), `ARB_MIN_NET_PROFIT_GBP` (1.00), `ARB_REQUEST_TIMEOUT_S` (8), `ARB_FX_CACHE_TTL_S` (30), `ARB_OFFER_TTL_S` (900), `ARB_RAIL_MAX_MILES` (400), `ARB_AIRPORT_OVERHEAD_MIN` (120), `ARB_RAIL_OVERHEAD_MIN` (30), `ARB_WEBHOOK_RETRIES` (2), `ARB_MOCK_FAIL_MARKETS` (e.g. `IN,AE`, for testing failure handling).
