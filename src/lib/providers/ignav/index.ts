// Ignav provider. Field names come from the generated OpenAPI types in
// ./schema.d.ts (regenerate with `npm run gen:ignav`).

import type { components } from "./schema";
import type { CallContext, FlightProvider, SearchFilters } from "@/lib/providers/types";
import { ProviderError } from "@/lib/providers/types";
import type { BookingLink, NormalisedItinerary, NormalisedRoundTrip, NormalisedSegment, Settings } from "@/lib/types";
import { minutesBetween, parseInstant } from "@/lib/engine/time";

type S = components["schemas"];
export type IgnavOneWayRequest = S["OneWayRequest"];
export type IgnavRoundTripRequest = S["RoundTripRequest"];
export type IgnavFareSearchResponse = S["FareSearchResponseModel"];
export type IgnavBookingLinksRequest = S["BookingLinksRequest"];
export type IgnavBookingLinksResponse = S["BookingOptionsResponseModel"] | S["SearchBookingOptionsResponseModel"];

const BASE_URL = "https://ignav.com";

async function ignavPost<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.IGNAV_API_KEY;
  if (!key) throw new ProviderError("IGNAV_API_KEY is not set on the server", null, "missing_api_key");
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    throw new ProviderError(`Could not reach Ignav: ${(err as Error).message}`, null, "network");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const detail = (json as S["ErrorResponseModel"] | null)?.error;
    throw new ProviderError(
      detail ? `${detail.message}${detail.field ? ` (${detail.field})` : ""}` : `Ignav returned HTTP ${res.status}`,
      res.status,
      detail?.code ?? null,
    );
  }
  return json as T;
}

export function buildOneWayRequest(
  origin: string,
  dest: string,
  date: string,
  filters: SearchFilters,
  settings: Settings,
): IgnavOneWayRequest {
  const body: IgnavOneWayRequest = {
    origin,
    destination: dest,
    departure_date: date,
    adults: filters.adults,
    children: filters.children,
    infants_in_seat: 0,
    infants_on_lap: filters.infants ?? 0,
    cabin_class: "economy",
    allow_self_transfer: filters.allowSelfTransfer,
    market: settings.market,
  };
  if (filters.maxStops != null) body.max_stops = filters.maxStops;
  const t = filters.timeRange;
  if (t && Object.values(t).some((v) => v != null)) {
    body.departure_time_range = {
      earliest_hour: t.earliestDepartHour ?? null,
      latest_hour: t.latestDepartHour ?? null,
      arrival_earliest_hour: t.earliestArriveHour ?? null,
      arrival_latest_hour: t.latestArriveHour ?? null,
    };
  }
  return body;
}

export function toGbp(amount: number, currency: string, settings: Settings): { gbp: number; approx: boolean } | null {
  if (currency === "GBP") return { gbp: amount, approx: false };
  const rate = settings.fx_to_gbp[currency];
  return rate ? { gbp: amount * rate, approx: true } : null;
}

/** UTC field if present, else local time + timezone. Never guesses: throws if neither. */
function segmentInstant(utc: string | null, local: string, tz: string | null): string {
  if (utc) return parseInstant(utc);
  if (tz) return parseInstant(local, tz);
  throw new Error(`no UTC time or timezone for ${local}`);
}

function normaliseSegment(s: S["SegmentModel"]): NormalisedSegment {
  const departUtc = segmentInstant(s.departure_time_utc, s.departure_time_local, s.departure_timezone);
  const arriveUtc = segmentInstant(s.arrival_time_utc, s.arrival_time_local, s.arrival_timezone);
  return {
    carrier: s.marketing_carrier_code,
    carrierName: s.operating_carrier_name,
    flightNumber: s.flight_number,
    origin: s.departure_airport,
    dest: s.arrival_airport,
    departUtc,
    arriveUtc,
    departTz: s.departure_timezone,
    arriveTz: s.arrival_timezone,
    durationMins: s.duration_minutes,
    aircraft: s.aircraft,
  };
}

type Meta = { fetchedAt: string; fromCache: boolean; passengers: number };

/** One direction of an Ignav itinerary. `priced` = carries the ticket price (inbound of a return fare doesn't). */
function normaliseLeg(
  it: S["ItineraryModel"],
  leg: S["LegModel"],
  priced: boolean,
  raw: IgnavFareSearchResponse,
  meta: Meta,
  settings: Settings,
): NormalisedItinerary {
  const segments = leg.segments.map(normaliseSegment);
  if (segments.length === 0) throw new Error("no segments");
  const fx = toGbp(it.price.amount, it.price.currency, settings);
  if (!fx) throw new Error(`no FX rate for ${it.price.currency}`);
  const totalGbp = settings.price_is_party_total ? fx.gbp : fx.gbp * meta.passengers;
  const departUtc = segments[0].departUtc;
  const arriveUtc = segments[segments.length - 1].arriveUtc;
  return {
    provider: "ignav",
    providerRef: it.ignav_id,
    origin: segments[0].origin,
    dest: segments[segments.length - 1].dest,
    departUtc,
    arriveUtc,
    durationMins: leg.duration_minutes ?? minutesBetween(departUtc, arriveUtc),
    // LegModel.carrier is the airline *name*; rules key on the IATA code.
    carrier: segments[0].carrier,
    carrierName: leg.carrier ?? segments[0].carrierName,
    segments,
    price: {
      amount: priced ? it.price.amount : 0,
      currency: it.price.currency,
      totalGbp: priced ? Math.round(totalGbp * 100) / 100 : 0,
      verified: it.price.status === "verified",
      fxApprox: fx.approx,
    },
    baggage: {
      // A bags object that lists carry-on but no checked count means no checked bag.
      checkedPieces: it.bags ? (it.bags.checked ?? 0) : null,
      carryOnPieces: it.bags?.carry_on ?? null,
    },
    selfTransfer: it.requires_self_transfer ?? false,
    observedAt: raw.observed_at ?? null,
    fetchedAt: meta.fetchedAt,
    fromCache: meta.fromCache,
  };
}

export function normaliseOneWay(
  raw: IgnavFareSearchResponse,
  meta: Meta,
  settings: Settings,
): { itineraries: NormalisedItinerary[]; skipped: number } {
  const out: NormalisedItinerary[] = [];
  let skipped = 0;
  for (const it of raw.itineraries ?? []) {
    try {
      out.push(normaliseLeg(it, it.outbound, true, raw, meta, settings));
    } catch {
      skipped++;
    }
  }
  return { itineraries: out, skipped };
}

/** Return fares: the outbound carries the whole price, the inbound is included in it. */
export function normaliseRoundTrip(
  raw: IgnavFareSearchResponse,
  meta: Meta,
  settings: Settings,
): { trips: NormalisedRoundTrip[]; skipped: number } {
  const trips: NormalisedRoundTrip[] = [];
  let skipped = 0;
  for (const it of raw.itineraries ?? []) {
    try {
      if (!it.inbound) throw new Error("no inbound");
      trips.push({ out: normaliseLeg(it, it.outbound, true, raw, meta, settings), back: normaliseLeg(it, it.inbound, false, raw, meta, settings) });
    } catch {
      skipped++;
    }
  }
  return { trips, skipped };
}

export function normaliseBookingLinks(raw: IgnavBookingLinksResponse): BookingLink[] {
  const links: BookingLink[] = [];
  for (const opt of raw.booking_options ?? []) {
    for (const l of opt.links) {
      links.push({
        providerName: l.provider_name,
        providerType: l.provider_type ?? null,
        exactFlight: l.specificity === "exact_flight",
        fareName: l.fare_name ?? null,
        price: l.price ? { amount: l.price.amount, currency: l.price.currency } : null,
        url: l.url,
      });
    }
  }
  return links;
}

export const ignavProvider: FlightProvider = {
  id: "ignav",

  async searchOneWay(origin, dest, date, filters, ctx: CallContext) {
    const body = buildOneWayRequest(origin, dest, date, filters, ctx.settings);
    const res = await ctx.call({
      provider: "ignav",
      endpoint: "/api/fares/one-way",
      body,
      label: `${origin}→${dest} ${date}`,
      fetcher: () => ignavPost<IgnavFareSearchResponse>("/api/fares/one-way", body),
    });
    return normaliseOneWay(
      res.raw as IgnavFareSearchResponse,
      { fetchedAt: res.fetchedAt, fromCache: res.fromCache, passengers: filters.adults + filters.children },
      ctx.settings,
    ).itineraries;
  },

  async searchRoundTrip(origin, dest, date, returnDate, filters, ctx: CallContext) {
    const body: IgnavRoundTripRequest = { ...buildOneWayRequest(origin, dest, date, filters, ctx.settings), return_date: returnDate };
    const res = await ctx.call({
      provider: "ignav",
      endpoint: "/api/fares/round-trip",
      body,
      label: `${origin}⇄${dest} ${date}/${returnDate}`,
      fetcher: () => ignavPost<IgnavFareSearchResponse>("/api/fares/round-trip", body),
    });
    return normaliseRoundTrip(
      res.raw as IgnavFareSearchResponse,
      { fetchedAt: res.fetchedAt, fromCache: res.fromCache, passengers: filters.adults + filters.children },
      ctx.settings,
    ).trips;
  },

  async getBookingLinks(providerRef, filters, ctx) {
    const body: IgnavBookingLinksRequest = {
      ignav_id: providerRef,
      adults: filters.adults,
      children: filters.children,
      infants_on_lap: filters.infants ?? 0,
      market: ctx.settings.market,
    };
    const res = await ctx.call({
      provider: "ignav",
      endpoint: "/api/fares/booking-links",
      body,
      label: `booking links ${providerRef.slice(0, 12)}`,
      fetcher: () => ignavPost<IgnavBookingLinksResponse>("/api/fares/booking-links", body),
    });
    return normaliseBookingLinks(res.raw as IgnavBookingLinksResponse);
  },
};
