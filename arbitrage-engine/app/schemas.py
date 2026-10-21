"""Pydantic V2 request/response contracts.

Money is always ``Decimal`` and serialises to a JSON string, so no amount ever passes
through binary floating point between the ledger and a client.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, field_validator, model_validator


def _upper(value: object) -> object:
    """Normalise codes before pattern checks (StringConstraints matches the raw input)."""
    return value.strip().upper() if isinstance(value, str) else value


IataAirport = Annotated[str, BeforeValidator(_upper), StringConstraints(pattern=r"^[A-Z]{3}$")]
IataCarrier = Annotated[str, BeforeValidator(_upper), StringConstraints(pattern=r"^[A-Z0-9]{2}$")]
CountryCode = Annotated[str, BeforeValidator(_upper), StringConstraints(pattern=r"^[A-Z]{2}$")]
CurrencyCode = Annotated[str, BeforeValidator(_upper), StringConstraints(pattern=r"^[A-Z]{3}$")]
PosRole = Literal["domestic", "destination", "carrier_hub"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


class SearchQuery(StrictModel):
    origin: IataAirport
    destination: IataAirport
    departure_date: date
    adults: int = Field(default=1, ge=1, le=9)
    carrier: IataCarrier | None = Field(default=None, description="Optional carrier whose home market is used as the carrier-hub POS.")

    @field_validator("departure_date")
    @classmethod
    def _not_in_past(cls, value: date) -> date:
        if value < datetime.now(timezone.utc).date():
            raise ValueError("departure_date is in the past")
        return value

    @model_validator(mode="after")
    def _distinct_airports(self) -> SearchQuery:
        if self.origin == self.destination:
            raise ValueError("origin and destination must differ")
        return self


class Money(StrictModel):
    amount: Decimal = Field(ge=0)
    currency: CurrencyCode


class PosNode(StrictModel):
    role: PosRole
    market: CountryCode
    currency: CurrencyCode
    carrier_basis: IataCarrier | None = Field(default=None, description="Carrier whose home market defined this node (carrier_hub only).")


class FlightFare(StrictModel):
    offer_id: str
    pos: PosNode
    carrier: IataCarrier
    flight_numbers: list[str]
    depart_at: datetime
    arrive_at: datetime
    duration_minutes: int = Field(gt=0)
    stops: int = Field(ge=0)
    price_local: Money
    mid_market_rate: Decimal = Field(gt=0, description="Units of the local currency per 1 GBP.")
    price_gbp_mid: Decimal = Field(description="Local price at the Wise mid-market rate, before fees.")
    landed_cost_gbp: Decimal = Field(description="GBP actually debited from Wise to pay the airline, incl. the conversion fee.")
    checkout_price_gbp: Decimal = Field(description="What the customer pays: landed cost + FX reserve + platform fee.")
    saving_vs_domestic_gbp: Decimal | None = None
    expires_at: datetime


class PosResult(StrictModel):
    pos: PosNode
    status: Literal["ok", "error"]
    fares: int = 0
    latency_ms: int = 0
    error: str | None = None


class RailFare(StrictModel):
    operator: str
    train_number: str
    origin_station: str
    destination_station: str
    depart_at: datetime
    arrive_at: datetime
    duration_minutes: int = Field(gt=0)
    door_to_door_minutes: int = Field(gt=0, description="Journey plus station check-in overhead.")
    price: Money
    price_gbp: Decimal


class TrainAlternative(StrictModel):
    priority: Literal["prioritized"] = "prioritized"
    reasons: list[Literal["faster", "cheaper"]]
    rail: RailFare
    compared_offer_id: str
    flight_door_to_door_minutes: int
    rail_door_to_door_minutes: int
    time_saved_minutes: int
    cost_saving_gbp: Decimal


class SearchResponse(StrictModel):
    query: SearchQuery
    home_currency: CurrencyCode
    train_alternative: TrainAlternative | None = None
    cheapest: FlightFare | None
    cheapest_pos_role: PosRole | None
    saving_vs_domestic_gbp: Decimal | None
    fares: list[FlightFare]
    pos_results: list[PosResult]
    distance_miles: float | None
    rail_checked: bool
    rail_error: str | None = None
    generated_at: datetime


# ---------------------------------------------------------------------------
# Checkout
# ---------------------------------------------------------------------------


class Passenger(StrictModel):
    title: Literal["MR", "MRS", "MS", "MISS", "MSTR", "DR"] | None = None
    first_name: Annotated[str, StringConstraints(min_length=1, max_length=60, pattern=r"^[A-Za-zÀ-ÿ' -]+$")]
    last_name: Annotated[str, StringConstraints(min_length=1, max_length=60, pattern=r"^[A-Za-zÀ-ÿ' -]+$")]
    date_of_birth: date
    nationality: CountryCode
    passport_number: Annotated[str, BeforeValidator(_upper), StringConstraints(min_length=5, max_length=20, pattern=r"^[A-Z0-9]+$")] | None = None

    @field_validator("date_of_birth")
    @classmethod
    def _adult(cls, value: date) -> date:
        today = datetime.now(timezone.utc).date()
        age = today.year - value.year - ((today.month, today.day) < (value.month, value.day))
        if value > today:
            raise ValueError("date_of_birth is in the future")
        if age < 12:
            raise ValueError("only adult (12+) passengers are supported in the MVP")
        return value


class Contact(StrictModel):
    email: Annotated[str, StringConstraints(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", to_lower=True)]
    phone: Annotated[str, StringConstraints(pattern=r"^\+[1-9][0-9]{6,14}$")]


class PaymentIn(StrictModel):
    amount_gbp: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    currency: Literal["GBP"] = "GBP"
    payment_reference: Annotated[str, StringConstraints(min_length=6, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


class CheckoutRequest(StrictModel):
    offer_id: str
    contact: Contact
    passengers: list[Passenger] = Field(min_length=1, max_length=9)
    payment: PaymentIn


class LedgerBreakdown(StrictModel):
    customer_paid_gbp: Decimal
    target_currency: CurrencyCode
    target_amount: Decimal = Field(description="Exact amount the agent pays the airline, in the POS currency.")
    mid_market_rate: Decimal
    wise_fee_rate: Decimal
    wise_fee_gbp: Decimal
    gbp_converted: Decimal = Field(description="GBP that reaches the conversion after Wise's fee.")
    wise_debit_gbp: Decimal = Field(description="Total GBP leaving the Wise GBP balance.")
    funded_target_amount: Decimal = Field(description="Foreign amount the debit actually buys (>= target_amount).")
    rounding_overfund: Decimal = Field(description="Foreign-currency pennies over target, left in the Wise balance.")
    fx_buffer_gbp: Decimal = Field(description="Reserve held back against the rate moving before manual booking.")
    gross_margin_gbp: Decimal
    net_profit_gbp: Decimal
    net_margin_pct: Decimal


class BookingInstructions(StrictModel):
    pos_market: CountryCode
    pos_currency: CurrencyCode
    vpn_node: str
    carrier: IataCarrier
    flight_numbers: list[str]
    depart_at: datetime
    pay_airline_amount: Money
    fund_from: str


class NotificationStatus(StrictModel):
    delivered: bool
    attempts: int
    error: str | None = None


class CheckoutResponse(StrictModel):
    order_id: str
    status: Literal["pending_manual_booking"]
    idempotent_replay: bool = False
    ledger: LedgerBreakdown
    booking_instructions: BookingInstructions
    notification: NotificationStatus
    created_at: datetime
