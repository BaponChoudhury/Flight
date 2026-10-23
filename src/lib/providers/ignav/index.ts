// Ignav provider. Field names come from the generated OpenAPI types in
// ./schema.d.ts (regenerate with `npm run gen:ignav`).

import type { components } from "./schema";
import type { CallContext, FlightProvider, SearchFilters } from "@/lib/providers/types";
import { ProviderError } from "@/lib/providers/types";
import type { BookingKey, BookingLink, NormalisedItinerary, NormalisedRoundTrip, NormalisedSegment, Settings } from "@/lib/types";
import { minutesBetween, parseInstant } from "@/lib/engine/time";

type S = components["schemas"];
export type IgnavOneWayRequest = S["OneWayRequest"];
export type IgnavRoundTripRequest = S["RoundTripRequest"];
export type IgnavFareSearchResponse = S["FareSearchResponseModel"];
export type IgnavBookingLinksRequest = S["BookingLinksRequest"];
export type IgnavBookingLinksResponse = S["BookingOptionsResponseModel"] | S["SearchBookingOptionsResponseModel"];

const BASE_URL = "https://ignav.com";

// Ignav sometimes fails a search it can answer a moment later (424 "Unable to complete
// request", rate limits, gateway errors). Failed calls aren't billed, so retry those once.
const RETRY_STATUSES = new Set([424, 429, 500, 502, 503, 504]);
const RETRY_DELAY_MS = 1_000;

async function ignavPost<T>(path: string, body: unknown): Promise<T> {
  try {
    return await ignavPostOnce<T>(path, body);
  } catch (err) {
    const retryable = err instanceof ProviderError && (err.code === "network" || (err.httpStatus != null && RETRY_STATUSES.has(err.httpStatus)));
    if (!retryable) throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return ignavPostOnce<T>(path, body);
  }
}

async function ignavPostOnce<T>(path: string, body: unknown): Promise<T> {
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
    // A timed-out call already used 45s of the request's budget: don't retry it.
    const timedOut = (err as Error).name === "TimeoutError";
    throw new ProviderError(`Could not reach Ignav: ${(err as Error).message}`, null, timedOut ? "timeout" : "network");
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
  if (filters.minCheckedBags) body.min_checked_bags = filters.minCheckedBags;
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
    bookingKey: keyOf(leg),
  };
}

function keyOf(leg: S["LegModel"]): BookingKey {
  const first = leg.segments[0];
  const last = leg.segments[leg.segments.length - 1];
  return {
    origin: first.departure_airport,
    dest: last.arrival_airport,
    date: first.departure_time_local.slice(0, 10),
    carrier: first.marketing_carrier_code,
    flightNumber: first.flight_number,
    flights: legFlights(leg),
  };
}

function legFlights(leg: S["LegModel"]): string[] {
  return leg.segments.map((s) => `${s.marketing_carrier_code ?? ""}${s.flight_number ?? ""}`);
}

/**
 * Ignav finds an itinerary by its FIRST flight only, so e.g. "GF8" can come back as
 * GF8+GF130 when we meant GF8+GF134. Only accept a response whose flights all match.
 */
export function bookingMatchesKey(raw: IgnavBookingLinksResponse, key: BookingKey): boolean {
  if (!key.flights?.length) return true; // older keys without the full list: can't check
  const it = raw.itinerary as Partial<S["BookingItineraryModel"] & S["SearchBookingItineraryModel"]>;
  const legs = it.outbound ? [it.outbound, it.inbound ?? null] : (it.legs ?? []);
  const same = (a: string[] | undefined, b: string[] | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
  if (!legs[0] || !same(legFlights(legs[0]), key.flights)) return false;
  if (key.ret?.flights) return !!legs[1] && same(legFlights(legs[1]), key.ret.flights);
  return true;
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
      const out = normaliseLeg(it, it.outbound, true, raw, meta, settings);
      const back = normaliseLeg(it, it.inbound, false, raw, meta, settings);
      const r = keyOf(it.inbound);
      out.bookingKey = { ...out.bookingKey!, ret: { date: r.date, carrier: r.carrier, flightNumber: r.flightNumber, flights: r.flights } };
      trips.push({ out, back });
    } catch {
      skipped++;
    }
  }
  return { trips, skipped };
}

export function bookingKeyRequest(key: BookingKey, filters: SearchFilters, settings: Settings, market = settings.market): IgnavBookingLinksRequest {
  return {
    origin: key.origin,
    destination: key.dest,
    departure_date: key.date,
    outbound_carrier_code: key.carrier,
    outbound_flight_number: key.flightNumber,
    ...(key.ret ? { return_date: key.ret.date, inbound_carrier_code: key.ret.carrier, inbound_flight_number: key.ret.flightNumber } : {}),
    adults: filters.adults,
    children: filters.children,
    infants_on_lap: filters.infants ?? 0,
    market,
  };
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

  async getMarketBookingLinks(key, filters, ctx, market) {
    // An ignav_id is tied to the market it was searched in, so other markets are looked up by flight details.
    const body = bookingKeyRequest(key, filters, ctx.settings, market);
    const res = await ctx.call({
      provider: "ignav",
      endpoint: "/api/fares/booking-links",
      body,
      label: `booking links [${market}] ${key.origin}-${key.dest} ${key.carrier}${key.flightNumber}`,
      fetcher: () => ignavPost<IgnavBookingLinksResponse>("/api/fares/booking-links", body),
    });
    const raw = res.raw as IgnavBookingLinksResponse;
    if (!bookingMatchesKey(raw, key)) return []; // a different connection: not comparable
    return normaliseBookingLinks(raw);
  },

  async getBookingLinks(providerRef, filters, ctx, key) {
    const fetchLinks = async (body: IgnavBookingLinksRequest, label: string, mustMatch?: BookingKey) => {
      const res = await ctx.call({
        provider: "ignav",
        endpoint: "/api/fares/booking-links",
        body,
        label,
        fetcher: () => ignavPost<IgnavBookingLinksResponse>("/api/fares/booking-links", body),
      });
      const raw = res.raw as IgnavBookingLinksResponse;
      // Don't send people to book a different connection than the one shown.
      if (mustMatch && !bookingMatchesKey(raw, mustMatch)) return [];
      return normaliseBookingLinks(raw);
    };
    try {
      // An ignav_id already encodes passengers and market; Ignav rejects those fields alongside it.
      return await fetchLinks({ ignav_id: providerRef }, `booking links ${providerRef.slice(0, 12)}`);
    } catch (err) {
      // ignav_ids expire; our results can be cached for up to 2h. Look the trip up by its flights instead.
      if (!key || !(err instanceof ProviderError) || !(err.httpStatus === 404 || /no itinerary matched/i.test(err.message))) throw err;
      return fetchLinks(bookingKeyRequest(key, filters, ctx.settings), `booking links ${key.origin}-${key.dest} ${key.carrier}${key.flightNumber}`, key);
    }
  },
};
