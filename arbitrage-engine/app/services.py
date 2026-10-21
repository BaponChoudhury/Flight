"""Domain services.

- ``WiseFintechService``      live mid-market rates (cached, single-flight) and all ledger maths.
- ``FlightService``           concurrent multi point-of-sale (POS) fare search.
- ``RailService``             high-speed rail journeys for short European hops.
- ``RailInterlineInterceptor`` decides when to check rail and whether to prioritise it.
- ``SearchOrchestrator``      runs flights and rail concurrently and assembles the answer.
- ``AdminNotifier``           Slack-style webhook with retries.
- ``CheckoutService``         re-prices the held offer at the live rate, books the ledger, notifies.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_FLOOR, ROUND_HALF_EVEN, Decimal, localcontext
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.config import Settings
from app.db import Database, DuplicatePaymentError
from app.reference import (
    AIRLINE_HOME_COUNTRY,
    AIRPORTS,
    FLAG_CARRIER,
    HUB_CARRIER_FALLBACKS,
    PENNY,
    ceil_to_minor,
    country_of_airport,
    currency_of_country,
    floor_to_minor,
    route_distance_miles,
    vpn_node_for,
)
from app.schemas import (
    BookingInstructions,
    CheckoutRequest,
    CheckoutResponse,
    Contact,
    FlightFare,
    LedgerBreakdown,
    Money,
    NotificationStatus,
    Passenger,
    PosNode,
    PosResult,
    RailFare,
    SearchQuery,
    SearchResponse,
    TrainAlternative,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Errors (mapped to HTTP responses in main.py)
# ---------------------------------------------------------------------------


class DomainError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class FxUnavailableError(DomainError):
    status_code = 503
    code = "fx_unavailable"


class SearchUnavailableError(DomainError):
    status_code = 502
    code = "all_pos_nodes_failed"


class UnsupportedRouteError(DomainError):
    status_code = 422
    code = "unsupported_route"


class OfferNotFoundError(DomainError):
    status_code = 404
    code = "offer_not_found"


class OfferExpiredError(DomainError):
    status_code = 410
    code = "offer_expired"


class CheckoutValidationError(DomainError):
    status_code = 422
    code = "checkout_invalid"


class MarginBreachError(DomainError):
    status_code = 409
    code = "requote_required"


class PaymentConflictError(DomainError):
    status_code = 409
    code = "payment_reference_conflict"


# ---------------------------------------------------------------------------
# Wise: rates + ledger
# ---------------------------------------------------------------------------


class _WiseRate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    rate: Decimal = Field(gt=0)
    source: str
    target: str


@dataclass(frozen=True, slots=True)
class WiseDebit:
    """Result of sizing a Wise GBP debit so it buys at least ``target`` in the foreign currency."""

    debit_gbp: Decimal
    fee_gbp: Decimal
    converted_gbp: Decimal
    funded_target: Decimal


class WiseFintechService:
    """Mid-market rates and the penny-safe ledger.

    Rounding policy (protects the margin; see README):
    - anything we pay (airline amount, Wise debit, Wise fee, reserves) rounds UP;
    - anything we count as ours (profit, margin %) rounds DOWN.
    """

    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self._client = client
        self._settings = settings
        self._cache: dict[tuple[str, str], tuple[Decimal, float]] = {}
        self._locks: dict[tuple[str, str], asyncio.Lock] = {}

    # -- rates ----------------------------------------------------------------

    async def get_mid_rate(self, source: str, target: str, *, force_refresh: bool = False) -> Decimal:
        """Units of ``target`` per 1 ``source`` at the Wise mid-market rate."""
        source, target = source.upper(), target.upper()
        if source == target:
            return Decimal(1)
        key = (source, target)
        cached = self._cache.get(key)
        if not force_refresh and cached and time.monotonic() - cached[1] < self._settings.fx_cache_ttl_s:
            return cached[0]
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:  # single-flight: concurrent POS nodes share one rate call
            cached = self._cache.get(key)
            if not force_refresh and cached and time.monotonic() - cached[1] < self._settings.fx_cache_ttl_s:
                return cached[0]
            rate = await self._fetch_rate(source, target)
            self._cache[key] = (rate, time.monotonic())
            return rate

    async def _fetch_rate(self, source: str, target: str) -> Decimal:
        headers = {"Authorization": f"Bearer {self._settings.wise_api_token}"} if self._settings.wise_api_token else {}
        try:
            resp = await self._client.get(self._settings.wise_rates_path, params={"source": source, "target": target}, headers=headers)
            resp.raise_for_status()
            rates = [_WiseRate.model_validate(item) for item in resp.json()]
        except httpx.HTTPStatusError as exc:
            raise FxUnavailableError(f"Wise rate {source}->{target}: HTTP {exc.response.status_code}") from exc
        except (httpx.RequestError, ValidationError, ValueError) as exc:
            raise FxUnavailableError(f"Wise rate {source}->{target}: {type(exc).__name__}") from exc
        match = next((r for r in rates if r.source.upper() == source and r.target.upper() == target), None)
        if match is None:
            raise FxUnavailableError(f"Wise returned no {source}->{target} rate")
        logger.debug("Wise mid-market %s->%s = %s", source, target, match.rate)
        return match.rate

    # -- ledger maths ---------------------------------------------------------

    def fee_rate_for(self, currency: str) -> Decimal:
        """No conversion (and no Wise fee) when paying in the home currency."""
        return Decimal(0) if currency.upper() == self._settings.home_currency else self._settings.wise_fee_rate

    def buffer_rate_for(self, currency: str) -> Decimal:
        """No FX reserve needed when there's no FX exposure."""
        return Decimal(0) if currency.upper() == self._settings.home_currency else self._settings.fx_buffer_rate

    def size_debit(self, target_amount: Decimal, currency: str, mid_rate: Decimal) -> WiseDebit:
        """Smallest whole-penny GBP debit whose post-fee conversion buys at least ``target_amount``.

        Wise charges its fee on the source amount, so ``converted = debit - fee`` and the
        foreign amount bought is ``converted * rate``, truncated to the currency's minor unit.
        Solve analytically, round up to the penny, then step up a penny at a time until the
        truncated foreign amount covers the target — so the airline payment is never short.
        """
        if target_amount <= 0:
            raise CheckoutValidationError("target amount must be positive")
        fee_rate = self.fee_rate_for(currency)
        with localcontext() as ctx:
            ctx.prec = 34
            exact = target_amount / (mid_rate * (Decimal(1) - fee_rate))
            debit = ceil_to_minor(exact, self._settings.home_currency)
            for _ in range(1000):
                fee = ceil_to_minor(debit * fee_rate, self._settings.home_currency)
                converted = debit - fee
                funded = floor_to_minor(converted * mid_rate, currency)
                if funded >= target_amount:
                    return WiseDebit(debit_gbp=debit, fee_gbp=fee, converted_gbp=converted, funded_target=funded)
                debit += PENNY
        raise FxUnavailableError("could not size a Wise debit for this amount")  # unreachable for sane rates

    def platform_fee(self, debit_gbp: Decimal) -> Decimal:
        return max(self._settings.platform_fee_min_gbp, ceil_to_minor(debit_gbp * self._settings.platform_fee_rate, "GBP"))

    def quote_checkout_price(self, target_amount: Decimal, currency: str, mid_rate: Decimal) -> tuple[WiseDebit, Decimal]:
        """Customer price = Wise debit + FX reserve + platform fee (each rounded up)."""
        debit = self.size_debit(target_amount, currency, mid_rate)
        buffer = ceil_to_minor(debit.debit_gbp * self.buffer_rate_for(currency), "GBP")
        return debit, debit.debit_gbp + buffer + self.platform_fee(debit.debit_gbp)

    def build_ledger(self, *, target_amount: Decimal, currency: str, mid_rate: Decimal, customer_paid_gbp: Decimal) -> LedgerBreakdown:
        debit = self.size_debit(target_amount, currency, mid_rate)
        buffer = ceil_to_minor(debit.debit_gbp * self.buffer_rate_for(currency), "GBP")
        gross = floor_to_minor(customer_paid_gbp - debit.debit_gbp, "GBP")
        net = floor_to_minor(gross - buffer, "GBP")
        margin_pct = (net / customer_paid_gbp * 100).quantize(Decimal("0.01"), rounding=ROUND_FLOOR)
        return LedgerBreakdown(
            customer_paid_gbp=customer_paid_gbp,
            target_currency=currency,
            target_amount=target_amount,
            mid_market_rate=mid_rate,
            wise_fee_rate=self.fee_rate_for(currency),
            wise_fee_gbp=debit.fee_gbp,
            gbp_converted=debit.converted_gbp,
            wise_debit_gbp=debit.debit_gbp,
            funded_target_amount=debit.funded_target,
            rounding_overfund=debit.funded_target - target_amount,
            fx_buffer_gbp=buffer,
            gross_margin_gbp=gross,
            net_profit_gbp=net,
            net_margin_pct=margin_pct,
        )

    def funding_source_for(self, currency: str) -> str:
        """Which Wise Business balance pays the airline."""
        home = self._settings.home_currency
        if currency.upper() == home:
            return f"Wise Business {home} balance (no conversion)"
        return f"Wise Business {home} balance -> convert to {currency.upper()} balance at the live rate, pay with the {currency.upper()} card"


# ---------------------------------------------------------------------------
# Flights: multi-POS
# ---------------------------------------------------------------------------


class _UpstreamPrice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    amount: Decimal = Field(gt=0)
    currency: str


class _UpstreamOffer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    offer_ref: str
    carrier: str
    flight_numbers: list[str]
    depart_at: datetime
    arrive_at: datetime
    duration_minutes: int = Field(gt=0)
    stops: int = Field(ge=0)
    price: _UpstreamPrice


class _UpstreamFlightResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    market: str
    currency: str
    offers: list[_UpstreamOffer]


class FlightService:
    def __init__(self, client: httpx.AsyncClient, settings: Settings, wise: WiseFintechService) -> None:
        self._client = client
        self._settings = settings
        self._wise = wise

    def resolve_pos_nodes(self, query: SearchQuery) -> list[PosNode]:
        """Domestic, destination and carrier-hub points of sale (duplicates collapsed)."""
        home = self._settings.home_market
        dest_country = country_of_airport(query.destination)
        origin_country = country_of_airport(query.origin)
        if dest_country is None or origin_country is None:
            raise UnsupportedRouteError(f"unknown airport in {query.origin}->{query.destination}")
        nodes = [PosNode(role="domestic", market=home, currency=self._settings.home_currency)]
        dest_currency = currency_of_country(dest_country)
        if dest_country != home and dest_currency:
            nodes.append(PosNode(role="destination", market=dest_country, currency=dest_currency))

        taken = {n.market for n in nodes}
        candidates = [query.carrier] if query.carrier else []
        candidates += [FLAG_CARRIER.get(dest_country), FLAG_CARRIER.get(origin_country), *HUB_CARRIER_FALLBACKS]
        for carrier in filter(None, candidates):
            market = AIRLINE_HOME_COUNTRY.get(carrier)
            currency = currency_of_country(market) if market else None
            if market and currency and market not in taken:
                nodes.append(PosNode(role="carrier_hub", market=market, currency=currency, carrier_basis=carrier))
                break
        return nodes

    async def search_multi_pos(self, query: SearchQuery) -> tuple[list[FlightFare], list[PosResult]]:
        nodes = self.resolve_pos_nodes(query)
        results = await asyncio.gather(*(self._search_node(node, query) for node in nodes))
        fares = [fare for node_fares, _ in results for fare in node_fares]
        return fares, [status for _, status in results]

    async def _search_node(self, node: PosNode, query: SearchQuery) -> tuple[list[FlightFare], PosResult]:
        started = time.perf_counter()

        def failed(reason: str) -> tuple[list[FlightFare], PosResult]:
            logger.warning("POS %s/%s failed: %s", node.role, node.market, reason)
            return [], PosResult(pos=node, status="error", latency_ms=_ms(started), error=reason)

        payload = {
            "origin": query.origin,
            "destination": query.destination,
            "departure_date": query.departure_date.isoformat(),
            "market": node.market,
            "currency": node.currency,
            "adults": query.adults,
        }
        try:
            # Fire the fare request and warm the FX rate concurrently.
            resp, rate = await asyncio.gather(
                self._client.post(self._settings.flight_search_path, json=payload),
                self._wise.get_mid_rate(self._settings.home_currency, node.currency),
            )
            resp.raise_for_status()
            body = _UpstreamFlightResponse.model_validate(resp.json())
        except httpx.TimeoutException:
            return failed("timeout")
        except httpx.HTTPStatusError as exc:
            return failed(f"HTTP {exc.response.status_code}")
        except httpx.RequestError as exc:
            return failed(f"network error: {type(exc).__name__}")
        except ValidationError:
            return failed("malformed upstream response")
        except FxUnavailableError as exc:
            return failed(exc.message)

        expires = datetime.now(timezone.utc) + timedelta(seconds=self._settings.offer_ttl_s)
        fares: list[FlightFare] = []
        for offer in body.offers:
            if offer.price.currency.upper() != node.currency:
                logger.warning("POS %s returned %s, expected %s; skipping offer", node.market, offer.price.currency, node.currency)
                continue
            amount = ceil_to_minor(offer.price.amount, node.currency)
            debit, checkout_price = self._wise.quote_checkout_price(amount, node.currency, rate)
            fares.append(
                FlightFare(
                    offer_id=f"{node.market}-{offer.offer_ref}",
                    pos=node,
                    carrier=offer.carrier,
                    flight_numbers=offer.flight_numbers,
                    depart_at=offer.depart_at,
                    arrive_at=offer.arrive_at,
                    duration_minutes=offer.duration_minutes,
                    stops=offer.stops,
                    price_local=Money(amount=amount, currency=node.currency),
                    mid_market_rate=rate,
                    price_gbp_mid=(amount / rate).quantize(PENNY, rounding=ROUND_HALF_EVEN),
                    landed_cost_gbp=debit.debit_gbp,
                    checkout_price_gbp=checkout_price,
                    expires_at=expires,
                )
            )
        logger.info("POS %s/%s: %d fares in %dms", node.role, node.market, len(fares), _ms(started))
        return fares, PosResult(pos=node, status="ok", fares=len(fares), latency_ms=_ms(started))


# ---------------------------------------------------------------------------
# Rail
# ---------------------------------------------------------------------------


class _UpstreamJourney(BaseModel):
    model_config = ConfigDict(extra="ignore")
    operator: str
    train_number: str
    depart_at: datetime
    arrive_at: datetime
    duration_minutes: int = Field(gt=0)
    price: _UpstreamPrice


class _UpstreamRailResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    journeys: list[_UpstreamJourney]


class RailService:
    def __init__(self, client: httpx.AsyncClient, settings: Settings, wise: WiseFintechService) -> None:
        self._client = client
        self._settings = settings
        self._wise = wise

    async def find_journeys(self, origin: str, destination: str, travel_date: date, adults: int) -> list[RailFare]:
        a, b = AIRPORTS[origin], AIRPORTS[destination]
        if not a.rail_station or not b.rail_station or a.rail_station == b.rail_station:
            return []
        resp = await self._client.post(
            self._settings.rail_search_path,
            json={"origin_station": a.rail_station, "destination_station": b.rail_station, "date": travel_date.isoformat(), "adults": adults},
        )
        resp.raise_for_status()
        body = _UpstreamRailResponse.model_validate(resp.json())
        fares: list[RailFare] = []
        for j in body.journeys:
            currency = j.price.currency.upper()
            rate = await self._wise.get_mid_rate(self._settings.home_currency, currency)
            fares.append(
                RailFare(
                    operator=j.operator,
                    train_number=j.train_number,
                    origin_station=a.rail_station,
                    destination_station=b.rail_station,
                    depart_at=j.depart_at,
                    arrive_at=j.arrive_at,
                    duration_minutes=j.duration_minutes,
                    door_to_door_minutes=j.duration_minutes + self._settings.rail_overhead_min,
                    price=Money(amount=j.price.amount, currency=currency),
                    # The traveller buys rail directly by card; compare at mid-market, rounded up.
                    price_gbp=ceil_to_minor(j.price.amount / rate, "GBP"),
                )
            )
        return fares


class RailInterlineInterceptor:
    """'Swap-to-train': for short hops between rail-connected hubs, check rail concurrently
    with flights and prioritise it when it is faster door-to-door or cheaper."""

    def __init__(self, rail: RailService, settings: Settings) -> None:
        self._rail = rail
        self._settings = settings

    def eligible(self, query: SearchQuery) -> tuple[bool, float | None]:
        miles = route_distance_miles(query.origin, query.destination)
        a, b = AIRPORTS.get(query.origin), AIRPORTS.get(query.destination)
        ok = miles is not None and miles < self._settings.rail_max_miles and bool(a and b and a.rail_station and b.rail_station)
        return ok, miles

    async def fetch(self, query: SearchQuery) -> list[RailFare]:
        return await self._rail.find_journeys(query.origin, query.destination, query.departure_date, query.adults)

    def evaluate(self, journeys: list[RailFare], flight: FlightFare | None) -> TrainAlternative | None:
        if not journeys or flight is None:
            return None
        flight_d2d = flight.duration_minutes + self._settings.airport_overhead_min
        best: tuple[tuple[int, int, Decimal], TrainAlternative] | None = None
        for j in journeys:
            reasons: list[Any] = []
            if j.door_to_door_minutes < flight_d2d:
                reasons.append("faster")
            if j.price_gbp < flight.checkout_price_gbp:
                reasons.append("cheaper")
            if not reasons:
                continue
            alt = TrainAlternative(
                reasons=reasons,
                rail=j,
                compared_offer_id=flight.offer_id,
                flight_door_to_door_minutes=flight_d2d,
                rail_door_to_door_minutes=j.door_to_door_minutes,
                time_saved_minutes=flight_d2d - j.door_to_door_minutes,
                cost_saving_gbp=flight.checkout_price_gbp - j.price_gbp,
            )
            # Prefer journeys that win on both, then the bigger time saving, then the lower price.
            rank = (len(reasons), alt.time_saved_minutes, alt.cost_saving_gbp)
            if best is None or rank > best[0]:
                best = (rank, alt)
        return best[1] if best else None


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


class SearchOrchestrator:
    def __init__(self, flights: FlightService, rail: RailInterlineInterceptor, db: Database, settings: Settings) -> None:
        self._flights = flights
        self._rail = rail
        self._db = db
        self._settings = settings

    async def search(self, query: SearchQuery) -> SearchResponse:
        rail_ok, miles = self._rail.eligible(query)

        async def rail_task() -> tuple[list[RailFare], str | None]:
            if not rail_ok:
                return [], None
            try:
                return await self._rail.fetch(query), None
            except (httpx.HTTPError, ValidationError, FxUnavailableError) as exc:
                logger.warning("Rail check failed: %s", exc)
                return [], f"rail lookup failed: {type(exc).__name__}"

        (fares, pos_results), (journeys, rail_error) = await asyncio.gather(self._flights.search_multi_pos(query), rail_task())
        if not fares and all(r.status == "error" for r in pos_results):
            raise SearchUnavailableError("every point-of-sale node failed: " + "; ".join(f"{r.pos.market}: {r.error}" for r in pos_results))

        fares = _with_domestic_savings(fares)
        fares.sort(key=lambda f: (f.checkout_price_gbp, f.duration_minutes))
        cheapest = fares[0] if fares else None
        domestic = [f for f in fares if f.pos.role == "domestic"]
        overall_saving = (domestic[0].checkout_price_gbp - cheapest.checkout_price_gbp) if cheapest and domestic else None

        if fares:
            await self._db.save_offers(fares, query.adults)
        return SearchResponse(
            query=query,
            home_currency=self._settings.home_currency,
            train_alternative=self._rail.evaluate(journeys, cheapest),
            cheapest=cheapest,
            cheapest_pos_role=cheapest.pos.role if cheapest else None,
            saving_vs_domestic_gbp=overall_saving,
            fares=fares,
            pos_results=pos_results,
            distance_miles=miles,
            rail_checked=rail_ok,
            rail_error=rail_error,
            generated_at=datetime.now(timezone.utc),
        )


def _with_domestic_savings(fares: list[FlightFare]) -> list[FlightFare]:
    """Tag each fare with how much it saves versus the same flights bought at the domestic POS."""
    domestic = {tuple(f.flight_numbers): f.checkout_price_gbp for f in fares if f.pos.role == "domestic"}
    out = []
    for f in fares:
        base = domestic.get(tuple(f.flight_numbers))
        saving = None if f.pos.role == "domestic" or base is None else base - f.checkout_price_gbp
        out.append(f.model_copy(update={"saving_vs_domestic_gbp": saving}))
    return out


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


class AdminNotifier:
    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self._client = client
        self._settings = settings

    async def notify(self, payload: dict[str, Any]) -> NotificationStatus:
        attempts = 0
        last_error: str | None = None
        for attempt in range(self._settings.webhook_retries + 1):
            attempts = attempt + 1
            try:
                resp = await self._client.post(self._settings.webhook_url, json=payload)
                resp.raise_for_status()
                return NotificationStatus(delivered=True, attempts=attempts)
            except httpx.HTTPStatusError as exc:
                last_error = f"HTTP {exc.response.status_code}"
            except httpx.RequestError as exc:
                last_error = f"network error: {type(exc).__name__}"
            if attempt < self._settings.webhook_retries:
                await asyncio.sleep(0.25 * 2**attempt)
        logger.error("Admin webhook failed after %d attempts: %s", attempts, last_error)
        return NotificationStatus(delivered=False, attempts=attempts, error=last_error)


def build_admin_payload(order_id: str, fare: FlightFare, ledger: LedgerBreakdown, instructions: BookingInstructions, contact: Contact, passengers: list[Passenger]) -> dict[str, Any]:
    """Slack-compatible message. Passport numbers are deliberately left out of chat; they stay in the database."""
    pay = f"{instructions.pay_airline_amount.amount} {instructions.pay_airline_amount.currency}"
    names = ", ".join(f"{p.last_name.upper()}/{p.first_name.upper()}" for p in passengers)
    text = (
        f":airplane: New order {order_id} — book {' + '.join(fare.flight_numbers)} on {fare.depart_at:%d %b %Y %H:%M}Z "
        f"via POS {instructions.pos_market}. Activate VPN {instructions.vpn_node}, pay {pay}. "
        f"Customer paid £{ledger.customer_paid_gbp}; net profit £{ledger.net_profit_gbp}."
    )
    return {
        "text": text,
        "blocks": [
            {"type": "section", "text": {"type": "mrkdwn", "text": text}},
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*VPN node*\n{instructions.vpn_node}"},
                    {"type": "mrkdwn", "text": f"*Pay airline*\n{pay}"},
                    {"type": "mrkdwn", "text": f"*Fund from*\n{instructions.fund_from}"},
                    {"type": "mrkdwn", "text": f"*Passengers*\n{names}"},
                ],
            },
        ],
        "order": {
            "order_id": order_id,
            "offer_id": fare.offer_id,
            "carrier": fare.carrier,
            "flight_numbers": fare.flight_numbers,
            "depart_at": fare.depart_at.isoformat(),
            "pos_market": instructions.pos_market,
            "vpn_node": instructions.vpn_node,
            "target_currency": ledger.target_currency,
            "target_amount": str(ledger.target_amount),
            "wise_debit_gbp": str(ledger.wise_debit_gbp),
            "net_profit_gbp": str(ledger.net_profit_gbp),
            "contact_email": contact.email,
            "passengers": [{"name": f"{p.first_name} {p.last_name}", "date_of_birth": p.date_of_birth.isoformat()} for p in passengers],
        },
    }


# ---------------------------------------------------------------------------
# Checkout
# ---------------------------------------------------------------------------


class CheckoutService:
    def __init__(self, db: Database, wise: WiseFintechService, notifier: AdminNotifier, settings: Settings) -> None:
        self._db = db
        self._wise = wise
        self._notifier = notifier
        self._settings = settings

    async def checkout(self, req: CheckoutRequest) -> CheckoutResponse:
        existing = await self._db.get_order_by_payment_reference(req.payment.payment_reference)
        if existing:
            return self._replay(existing, req)

        held = await self._db.get_offer(req.offer_id)
        if held is None:
            raise OfferNotFoundError(f"offer {req.offer_id} not found — search again")
        fare, adults = held
        if fare.expires_at <= datetime.now(timezone.utc):
            raise OfferExpiredError(f"offer {req.offer_id} expired at {fare.expires_at.isoformat()} — search again")
        if len(req.passengers) != adults:
            raise CheckoutValidationError(f"offer was priced for {adults} passenger(s); got {len(req.passengers)}")
        if req.payment.amount_gbp < fare.checkout_price_gbp:
            raise CheckoutValidationError(f"payment £{req.payment.amount_gbp} is below the quoted £{fare.checkout_price_gbp}")

        currency = fare.price_local.currency
        live_rate = await self._wise.get_mid_rate(self._settings.home_currency, currency, force_refresh=True)
        ledger = self._wise.build_ledger(
            target_amount=fare.price_local.amount, currency=currency, mid_rate=live_rate, customer_paid_gbp=req.payment.amount_gbp
        )
        if ledger.net_profit_gbp < self._settings.min_net_profit_gbp:
            raise MarginBreachError(
                f"the {currency} rate moved (quoted {fare.mid_market_rate}, live {live_rate}); net profit would be "
                f"£{ledger.net_profit_gbp} — re-quote before taking payment"
            )

        instructions = BookingInstructions(
            pos_market=fare.pos.market,
            pos_currency=currency,
            vpn_node=vpn_node_for(fare.pos.market),
            carrier=fare.carrier,
            flight_numbers=fare.flight_numbers,
            depart_at=fare.depart_at,
            pay_airline_amount=Money(amount=ledger.target_amount, currency=currency),
            fund_from=self._wise.funding_source_for(currency),
        )
        try:
            order_id, created_at = await self._db.create_order(
                offer_id=fare.offer_id,
                payment_reference=req.payment.payment_reference,
                contact=req.contact.model_dump(mode="json"),
                passengers=[p.model_dump(mode="json") for p in req.passengers],
                ledger=ledger.model_dump(mode="json"),
                instructions=instructions.model_dump(mode="json"),
            )
        except DuplicatePaymentError:
            # Lost a race with an identical request: return the winner's order.
            existing = await self._db.get_order_by_payment_reference(req.payment.payment_reference)
            if existing is None:
                raise
            return self._replay(existing, req)

        logger.info("Order %s: pay %s %s, net profit £%s", order_id, ledger.target_amount, currency, ledger.net_profit_gbp)
        notification = await self._notifier.notify(build_admin_payload(order_id, fare, ledger, instructions, req.contact, req.passengers))
        await self._db.set_notification(order_id, notification.model_dump(mode="json"))
        return CheckoutResponse(
            order_id=order_id,
            status="pending_manual_booking",
            ledger=ledger,
            booking_instructions=instructions,
            notification=notification,
            created_at=datetime.fromisoformat(created_at),
        )

    @staticmethod
    def _replay(existing: dict[str, Any], req: CheckoutRequest) -> CheckoutResponse:
        if existing["offer_id"] != req.offer_id:
            raise PaymentConflictError(f"payment reference {req.payment.payment_reference} was already used for another offer")
        notification = existing["notification"] or {"delivered": False, "attempts": 0, "error": "notification pending"}
        return CheckoutResponse(
            order_id=existing["order_id"],
            status="pending_manual_booking",
            idempotent_replay=True,
            ledger=LedgerBreakdown.model_validate(existing["ledger"]),
            booking_instructions=BookingInstructions.model_validate(existing["instructions"]),
            notification=NotificationStatus.model_validate(notification),
            created_at=datetime.fromisoformat(existing["created_at"]),
        )


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)
