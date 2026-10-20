// Ignav provider. Field names come from the generated OpenAPI types in
// ./schema.d.ts (regenerate with `npm run gen:ignav`).

import type { components } from "./schema";
import type { CallContext, FlightProvider, SearchFilters } from "@/lib/providers/types";
import { ProviderError } from "@/lib/providers/types";
import type { BookingLink, NormalisedItinerary, NormalisedSegment, Settings } from "@/lib/types";
import { minutesBetween, parseInstant } from "@/lib/engine/time";

type S = components["schemas"];
export type IgnavOneWayRequest = S["OneWayRequest"];
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
    infants_on_lap: 0,
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

function normaliseSegment(s: S["SegmentModel"]): NormalisedSegment {
  const departUtc = s.departure_time_utc
    ? parseInstant(s.departure_time_utc)
    : parseInstant(s.departure_time_local, s.departure_timezone);
  const arriveUtc = s.arrival_time_utc
    ? parseInstant(s.arrival_time_utc)
    : parseInstant(s.arrival_time_local, s.arrival_timezone);
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

export function normaliseOneWay(
  raw: IgnavFareSearchResponse,
  meta: { fetchedAt: string; fromCache: boolean; passengers: number },
  settings: Settings,
): { itineraries: NormalisedItinerary[]; skipped: number } {
  const out: NormalisedItinerary[] = [];
  let skipped = 0;
  for (const it of raw.itineraries ?? []) {
    try {
      const segments = it.outbound.segments.map(normaliseSegment);
      if (segments.length === 0) throw new Error("no segments");
      const fx = toGbp(it.price.amount, it.price.currency, settings);
      if (!fx) throw new Error(`no FX rate for ${it.price.currency}`);
      const totalGbp = settings.price_is_party_total ? fx.gbp : fx.gbp * meta.passengers;
      const departUtc = segments[0].departUtc;
      const arriveUtc = segments[segments.length - 1].arriveUtc;
      out.push({
        provider: "ignav",
        providerRef: it.ignav_id,
        origin: segments[0].origin,
        dest: segments[segments.length - 1].dest,
        departUtc,
        arriveUtc,
        durationMins: it.outbound.duration_minutes ?? minutesBetween(departUtc, arriveUtc),
        carrier: it.outbound.carrier ?? segments[0].carrier,
        segments,
        price: {
          amount: it.price.amount,
          currency: it.price.currency,
          totalGbp: Math.round(totalGbp * 100) / 100,
          verified: it.price.status === "verified",
          fxApprox: fx.approx,
        },
        baggage: {
          checkedPieces: it.bags?.checked ?? null,
          carryOnPieces: it.bags?.carry_on ?? null,
        },
        selfTransfer: it.requires_self_transfer ?? false,
        observedAt: raw.observed_at ?? null,
        fetchedAt: meta.fetchedAt,
        fromCache: meta.fromCache,
      });
    } catch {
      skipped++;
    }
  }
  return { itineraries: out, skipped };
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

  async getBookingLinks(providerRef, filters, ctx) {
    const body: IgnavBookingLinksRequest = {
      ignav_id: providerRef,
      adults: filters.adults,
      children: filters.children,
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
