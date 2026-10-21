"""Static reference data: airports, currencies, carriers, rail stations and VPN egress nodes.

Kept deliberately small for the MVP; every lookup degrades gracefully when a code is unknown.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal


@dataclass(frozen=True, slots=True)
class Airport:
    code: str
    city: str
    country: str
    lat: float
    lon: float
    rail_station: str | None = None  # city-centre high-speed rail station, if the swap-to-train router covers it


AIRPORTS: dict[str, Airport] = {
    a.code: a
    for a in (
        Airport("LHR", "London", "GB", 51.4700, -0.4543, "London St Pancras International"),
        Airport("LGW", "London", "GB", 51.1537, -0.1821, "London St Pancras International"),
        Airport("MAN", "Manchester", "GB", 53.3537, -2.2750),
        Airport("CDG", "Paris", "FR", 49.0097, 2.5479, "Paris Gare du Nord"),
        Airport("ORY", "Paris", "FR", 48.7262, 2.3652, "Paris Gare du Nord"),
        Airport("AMS", "Amsterdam", "NL", 52.3105, 4.7683, "Amsterdam Centraal"),
        Airport("BRU", "Brussels", "BE", 50.9010, 4.4844, "Bruxelles-Midi"),
        Airport("FRA", "Frankfurt", "DE", 50.0379, 8.5622, "Frankfurt (Main) Hbf"),
        Airport("CGN", "Cologne", "DE", 50.8659, 7.1427, "Köln Hbf"),
        Airport("DEL", "Delhi", "IN", 28.5562, 77.1000),
        Airport("BOM", "Mumbai", "IN", 19.0896, 72.8656),
        Airport("GAU", "Guwahati", "IN", 26.1061, 91.5859),
        Airport("DXB", "Dubai", "AE", 25.2532, 55.3657),
        Airport("DOH", "Doha", "QA", 25.2731, 51.6081),
        Airport("IST", "Istanbul", "TR", 41.2753, 28.7519),
        Airport("JFK", "New York", "US", 40.6413, -73.7781),
        Airport("NRT", "Tokyo", "JP", 35.7720, 140.3929),
    )
}

COUNTRY_CURRENCY: dict[str, str] = {
    "GB": "GBP", "FR": "EUR", "NL": "EUR", "BE": "EUR", "DE": "EUR", "IN": "INR",
    "AE": "AED", "QA": "QAR", "TR": "TRY", "US": "USD", "JP": "JPY",
}

# ISO 4217 minor units; anything not listed has 2.
_MINOR_UNITS: dict[str, int] = {"JPY": 0, "KWD": 3, "BHD": 3, "OMR": 3}

AIRLINE_HOME_COUNTRY: dict[str, str] = {
    "BA": "GB", "VS": "GB", "AF": "FR", "KL": "NL", "SN": "BE", "LH": "DE", "AI": "IN",
    "6E": "IN", "EK": "AE", "QR": "QA", "TK": "TR", "AA": "US", "JL": "JP",
}

FLAG_CARRIER: dict[str, str] = {
    "GB": "BA", "FR": "AF", "NL": "KL", "BE": "SN", "DE": "LH", "IN": "AI",
    "AE": "EK", "QA": "QR", "TR": "TK", "US": "AA", "JP": "JL",
}

# Long-haul hub carriers tried, in order, when the route's own flag carriers share a
# market with the domestic or destination point of sale.
HUB_CARRIER_FALLBACKS: tuple[str, ...] = ("EK", "QR", "TK", "LH")

# Egress nodes the booking agent switches to so the airline sees the right point of sale.
VPN_NODES: dict[str, str] = {
    "GB": "gb-lon-01 (London)", "FR": "fr-par-01 (Paris)", "NL": "nl-ams-01 (Amsterdam)",
    "BE": "be-bru-01 (Brussels)", "DE": "de-fra-01 (Frankfurt)", "IN": "in-bom-01 (Mumbai)",
    "AE": "ae-dxb-01 (Dubai)", "QA": "qa-doh-01 (Doha)", "TR": "tr-ist-01 (Istanbul)",
    "US": "us-nyc-01 (New York)", "JP": "jp-tyo-01 (Tokyo)",
}

PENNY = Decimal("0.01")


def minor_unit_quantum(currency: str) -> Decimal:
    """Smallest unit of ``currency`` (e.g. 0.01 GBP, 1 JPY)."""
    return Decimal(1).scaleb(-_MINOR_UNITS.get(currency.upper(), 2))


def ceil_to_minor(amount: Decimal, currency: str) -> Decimal:
    """Round *up* to the currency's smallest unit — used for anything we must pay."""
    return amount.quantize(minor_unit_quantum(currency), rounding=ROUND_CEILING)


def floor_to_minor(amount: Decimal, currency: str) -> Decimal:
    """Round *down* to the currency's smallest unit — used for anything we book as profit."""
    return amount.quantize(minor_unit_quantum(currency), rounding=ROUND_FLOOR)


def country_of_airport(code: str) -> str | None:
    airport = AIRPORTS.get(code.upper())
    return airport.country if airport else None


def currency_of_country(country: str) -> str | None:
    return COUNTRY_CURRENCY.get(country.upper())


def vpn_node_for(market: str) -> str:
    return VPN_NODES.get(market.upper(), f"{market.lower()}-01 (no dedicated node configured)")


def haversine_miles(a: Airport, b: Airport) -> float:
    """Great-circle distance in statute miles."""
    radius_miles = 3958.7613
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp, dl = p2 - p1, math.radians(b.lon - a.lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius_miles * math.asin(math.sqrt(h))


def route_distance_miles(origin: str, destination: str) -> float | None:
    a, b = AIRPORTS.get(origin.upper()), AIRPORTS.get(destination.upper())
    return round(haversine_miles(a, b), 1) if a and b else None
