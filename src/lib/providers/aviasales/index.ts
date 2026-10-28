// Aviasales provider (Travelpayouts Flights Search API, v1 on api.travelpayouts.com).
// Field names follow https://support.travelpayouts.com/hc/en-us/articles/203956173.
// Used for through tickets alongside Ignav: it adds many more sellers, bag details for
// most offers, and refund / change rules per fare.
//
// Rules from the API terms that this adapter keeps:
// - each search carries the real user's IP and the site's host;
// - a booking link is only requested when the user taps "Get booking links";
// - search results (and their links) live 15 minutes, so they're cached for less.

import { createHash } from "node:crypto";
import type { CallContext, FlightProvider, SearchFilters } from "@/lib/providers/types";
import { ProviderError } from "@/lib/providers/types";
import type { BookingKey, BookingLink, FareTerms, NormalisedItinerary, NormalisedRoundTrip, NormalisedSegment } from "@/lib/types";
import { localHour } from "@/lib/engine/time";

const BASE_URL = "https://api.travelpayouts.com";
/** Results are valid for 15 minutes; leave room for the user to tap "Get booking links". */
const CACHE_MINS = 10;
/** Stop polling after this long and use what has arrived (the search route has 60s in total). */
const POLL_BUDGET_MS = 35_000;
const POLL_EVERY_MS = 1_500;

/** Who is searching: the API needs the user's own IP and the site they search on. */
export interface AviasalesClient {
  ip: string;
  host: string;
}

// ---------- Raw API shapes (only the fields we use) ----------

interface RawFlight {
  departure: string;
  arrival: string;
  departure_timestamp: number; // unix seconds, UTC
  arrival_timestamp: number;
  duration: number;
  marketing_carrier: string;
  operating_carrier?: string;
  number: string;
  aircraft?: string | null;
}

interface RawTariffInfo {
  return_before_flight?: { available?: boolean; penalty?: { currency_code?: string; value?: number } } | null;
  change_before_flight?: { available?: boolean } | null;
}

interface RawTerm {
  currency: string;
  price: number;
  unified_price: number; // RUB, whole party
  url: number | string;
  flights_baggage?: (string | false | null)[][];
  flights_handbags?: (string | false | null)[][];
  flight_additional_tariff_infos?: (RawTariffInfo | null)[][];
  transfer_terms?: ({ is_virtual_interline?: boolean } | null)[][];
}

interface RawProposal {
  segment: { flight: RawFlight[] }[];
  terms: Record<string, RawTerm>;
}

/** What we cache: the search id, rates and the proposals, trimmed to the fields above. */
export interface AviasalesSearch {
  searchId: string;
  /** RUB per unit of each currency (lower-case codes), from the start response. */
  rates: Record<string, number>;
  airports: Record<string, { tz: string | null }>;
  gates: Record<string, string>;
  /** Alliance of each airline (null = none), to spot mixed-airline fares that are really separate tickets. */
  alliances?: Record<string, string | null>;
  proposals: RawProposal[];
  complete: boolean;
}

// ---------- Signing ----------

/** Values of every parameter, keys sorted alphabetically at each level, arrays kept in order. */
export function signatureValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(signatureValues);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return Object.keys(o).sort().flatMap((k) => signatureValues(o[k]));
  }
  return [String(value)];
}

export function signatureString(token: string, body: Record<string, unknown>): string {
  return [token, ...signatureValues(body)].join(":");
}

export function sign(token: string, body: Record<string, unknown>): string {
  return createHash("md5").update(signatureString(token, body)).digest("hex");
}

// ---------- HTTP ----------

// Every request carries the end user's IP in x-user-ip (Travelpayouts' rule; their limit is 100 requests an hour per user IP).
async function asFetch<T>(path: string, init: { body?: unknown; userIp: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: init.body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "Accept-Encoding": "gzip", "x-user-ip": init.userIp },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new ProviderError(`Could not reach Aviasales: ${(err as Error).message}`, null, "network");
  }
  const text = await res.text();
  if (!res.ok) throw new ProviderError(`Aviasales returned HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`, res.status);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError("Aviasales returned a response that isn't JSON", res.status);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function trimTerm(t: RawTerm): RawTerm {
  return {
    currency: t.currency,
    price: t.price,
    unified_price: t.unified_price,
    url: t.url,
    flights_baggage: t.flights_baggage,
    flights_handbags: t.flights_handbags,
    flight_additional_tariff_infos: t.flight_additional_tariff_infos,
    transfer_terms: t.transfer_terms,
  };
}

/** Start a search and poll until it's over (or the time budget runs out). */
async function runAviasalesSearch(body: Record<string, unknown>, now = Date.now): Promise<AviasalesSearch> {
  const started = now();
  const userIp = String(body.user_ip);
  const start = await asFetch<{ search_id?: string; currency_rates?: Record<string, number> }>("/v1/flight_search", { body, userIp });
  if (!start.search_id || !start.currency_rates?.gbp) throw new ProviderError("Aviasales didn't start the search", null);
  const out: AviasalesSearch = { searchId: start.search_id, rates: start.currency_rates, airports: {}, gates: {}, alliances: {}, proposals: [], complete: false };
  while (now() - started < POLL_BUDGET_MS) {
    const chunks = await asFetch<Record<string, unknown>[]>(`/v1/flight_search_results?uuid=${encodeURIComponent(out.searchId)}`, { userIp });
    for (const ch of chunks) {
      for (const [code, a] of Object.entries((ch.airports ?? {}) as Record<string, { time_zone?: string }>)) out.airports[code] = { tz: a.time_zone ?? null };
      for (const [id, g] of Object.entries((ch.gates_info ?? {}) as Record<string, { label?: string }>)) out.gates[id] = g.label ?? id;
      for (const [code, a] of Object.entries((ch.airlines ?? {}) as Record<string, { alliance_name?: string | null }>)) out.alliances![code] = a.alliance_name ?? null;
      for (const p of (ch.proposals ?? []) as RawProposal[]) {
        out.proposals.push({
          segment: p.segment.map((s) => ({
            flight: s.flight.map((f) => ({
              departure: f.departure,
              arrival: f.arrival,
              departure_timestamp: f.departure_timestamp,
              arrival_timestamp: f.arrival_timestamp,
              duration: f.duration,
              marketing_carrier: f.marketing_carrier,
              operating_carrier: f.operating_carrier,
              number: f.number,
              aircraft: f.aircraft ?? null,
            })),
          })),
          terms: Object.fromEntries(Object.entries(p.terms).map(([g, t]) => [g, trimTerm(t)])),
        });
      }
    }
    // The last response is a single object holding only the search id.
    if (chunks.some((c) => Object.keys(c).length === 1 && "search_id" in c)) {
      out.complete = true;
      break;
    }
    await sleep(POLL_EVERY_MS);
  }
  return out;
}

// ---------- Normalising ----------

/** "1PC23" → 1, "2PC" → 2, "0PC"/false → 0; "" / null / weight-only ("20") → unknown. */
export function bagPieces(code: string | false | null | undefined): number | null {
  if (code === false) return 0;
  if (!code) return null;
  const m = /^(\d+)PC/i.exec(code);
  return m ? Number(m[1]) : null;
}

/** Fewest bags across the flights of one direction: that's what you can rely on. */
function legPieces(codes: (string | false | null)[] | undefined): number | null {
  if (!codes?.length) return null;
  const pieces = codes.map(bagPieces);
  return pieces.some((p) => p == null) ? null : Math.min(...(pieces as number[]));
}

const toGbp = (amount: number, currency: string, rates: Record<string, number>) => {
  const rub = currency.toLowerCase() === "rub" ? amount : amount * (rates[currency.toLowerCase()] ?? NaN);
  const gbp = rub / rates.gbp;
  return Number.isFinite(gbp) ? Math.round(gbp * 100) / 100 : null;
};

/** Refundable / changeable only when every flight of the ticket says so. */
export function fareTermsOf(t: RawTerm, rates: Record<string, number>): FareTerms {
  const infos = (t.flight_additional_tariff_infos ?? []).flat();
  const all = (pick: (i: RawTariffInfo) => boolean | undefined): boolean | null => {
    if (!infos.length) return null;
    const v = infos.map((i) => (i ? pick(i) : undefined));
    if (v.some((x) => x === false)) return false;
    return v.every((x) => x === true) ? true : null;
  };
  const refundable = all((i) => i.return_before_flight?.available);
  const penalties = infos
    .map((i) => i?.return_before_flight?.penalty)
    .filter((p): p is { currency_code: string; value: number } => !!p?.currency_code && typeof p.value === "number");
  // Fees are stated once per flight of the fare; the largest is the one that applies to the ticket.
  const fees = penalties.map((p) => toGbp(p.value, p.currency_code, rates)).filter((x): x is number => x != null);
  return {
    refundable,
    refundFeeGbp: refundable && fees.length ? Math.max(...fees) : null,
    changeable: all((i) => i.change_before_flight?.available),
  };
}

const isVirtualInterline = (t: RawTerm, leg: number) => (t.transfer_terms?.[leg] ?? []).some((x) => !!x?.is_virtual_interline);

/**
 * Sellers don't always flag self-made combos (e.g. Ryanair + Azerbaijan Airlines sold as one
 * "trip"). Treat airlines that share no alliance as separate tickets: at worst a protected
 * interline gets the separate-ticket warning and connection checks, never the reverse.
 */
export function looksSelfTransfer(flights: { marketing_carrier: string }[], alliances: Record<string, string | null> = {}): boolean {
  const carriers = [...new Set(flights.map((f) => f.marketing_carrier))];
  if (carriers.length < 2) return false;
  const a = carriers.map((c) => alliances[c] ?? null);
  return a.some((x) => x == null) || new Set(a).size > 1;
}

export function parseRef(ref: string): { searchId: string; url: string; seller: string } | null {
  const [tag, searchId, url, seller] = ref.split("|");
  return tag === "as1" && searchId && url ? { searchId, url, seller: decodeURIComponent(seller ?? "") } : null;
}

interface NormaliseOpts {
  filters: SearchFilters;
  /** Requested origin; an airport code (not a city) keeps only flights from that airport. */
  origin: string;
  fetchedAt: string;
  fromCache: boolean;
}

/** One itinerary (or return pair) per proposal, priced at its cheapest seller that fits the filters. */
export function normaliseSearch(raw: AviasalesSearch, o: NormaliseOpts): { out: NormalisedItinerary; back: NormalisedItinerary | null }[] {
  const f = o.filters;
  const originIsAirport = o.origin in raw.airports;
  const result: { out: NormalisedItinerary; back: NormalisedItinerary | null }[] = [];
  for (const p of raw.proposals) {
    const legs = p.segment.map((s) => s.flight);
    if (!legs.length || legs.some((l) => !l.length)) continue;
    if (f.maxStops != null && legs.some((l) => l.length - 1 > f.maxStops!)) continue;
    if (originIsAirport && legs[0][0].departure !== o.origin) continue;
    const tz = (iata: string) => raw.airports[iata]?.tz ?? null;
    const t = f.timeRange;
    const first = legs[0][0];
    const last = legs[0][legs[0].length - 1];
    const depTz = tz(first.departure);
    const arrTz = tz(last.arrival);
    if (t?.earliestDepartHour != null && depTz && localHour(new Date(first.departure_timestamp * 1000).toISOString(), depTz) < t.earliestDepartHour) continue;
    if (t?.latestArriveHour != null && arrTz && localHour(new Date(last.arrival_timestamp * 1000).toISOString(), arrTz) > t.latestArriveHour) continue;

    const unflaggedCombo = legs.map((l) => looksSelfTransfer(l, raw.alliances));
    const selfTransferLeg = (term: RawTerm, i: number) => isVirtualInterline(term, i) || unflaggedCombo[i];
    type Pick = { gate: string; term: RawTerm; gbp: number; terms: FareTerms; pieces: (number | null)[] };
    // The cheapest seller, plus the cheapest refundable one when that's a different fare,
    // so the results page can filter to refundable tickets without a new search.
    let best: Pick | null = null;
    let bestRefundable: Pick | null = null;
    for (const [gate, term] of Object.entries(p.terms)) {
      const gbp = term.unified_price / raw.rates.gbp;
      if (!Number.isFinite(gbp) || gbp <= 0) continue;
      if (!f.allowSelfTransfer && legs.some((_, i) => selfTransferLeg(term, i))) continue;
      const terms = fareTermsOf(term, raw.rates);
      if (f.refundableOnly && terms.refundable !== true) continue;
      const pieces = legs.map((_, i) => legPieces(term.flights_baggage?.[i] ?? undefined));
      // Like Ignav's bag filter: drop fares known to lack the bags; unknown stays ("bag price unknown").
      if (f.minCheckedBags && pieces.some((n) => n != null && n < f.minCheckedBags!)) continue;
      const pick: Pick = { gate, term, gbp, terms, pieces };
      if (!best || gbp < best.gbp) best = pick;
      if (terms.refundable === true && (!bestRefundable || gbp < bestRefundable.gbp)) bestRefundable = pick;
    }
    if (!best) continue;

    for (const pick of bestRefundable && bestRefundable !== best ? [best, bestRefundable] : [best]) {
      const seller = raw.gates[pick.gate] ?? null;
      const providerRef = `as1|${raw.searchId}|${pick.term.url}|${encodeURIComponent(seller ?? "")}`;
      const totalGbp = Math.round(pick.gbp * 100) / 100;
      const build = (flights: RawFlight[], i: number, priced: boolean): NormalisedItinerary => {
        const segments: NormalisedSegment[] = flights.map((fl) => ({
          carrier: fl.marketing_carrier,
          carrierName: null,
          flightNumber: fl.number,
          origin: fl.departure,
          dest: fl.arrival,
          departUtc: new Date(fl.departure_timestamp * 1000).toISOString(),
          arriveUtc: new Date(fl.arrival_timestamp * 1000).toISOString(),
          departTz: tz(fl.departure),
          arriveTz: tz(fl.arrival),
          durationMins: fl.duration,
          aircraft: fl.aircraft ?? null,
        }));
        const s0 = segments[0];
        const sN = segments[segments.length - 1];
        return {
          provider: "aviasales",
          providerRef,
          origin: s0.origin,
          dest: sN.dest,
          departUtc: s0.departUtc,
          arriveUtc: sN.arriveUtc,
          durationMins: Math.round((Date.parse(sN.arriveUtc) - Date.parse(s0.departUtc)) / 60000),
          carrier: s0.carrier,
          carrierName: null,
          segments,
          price: {
            amount: priced ? pick.term.price : 0,
            currency: pick.term.currency.toUpperCase(),
            totalGbp: priced ? totalGbp : 0,
            verified: true,
            fxApprox: pick.term.currency.toLowerCase() !== "gbp",
          },
          baggage: { checkedPieces: pick.pieces[i], carryOnPieces: legPieces(pick.term.flights_handbags?.[i] ?? undefined) },
          selfTransfer: selfTransferLeg(pick.term, i),
          fareTerms: pick.terms,
          seller,
          observedAt: null,
          fetchedAt: o.fetchedAt,
          fromCache: o.fromCache,
          bookingKey: keyOf(segments),
        };
      };
      const out = build(legs[0], 0, true);
      const back = legs[1] ? build(legs[1], 1, false) : null;
      if (back) {
        const r = back.bookingKey!;
        out.bookingKey = { ...out.bookingKey!, ret: { date: r.date, carrier: r.carrier, flightNumber: r.flightNumber, flights: r.flights } };
      }
      result.push({ out, back });
    }
  }
  return result;
}

function keyOf(segments: NormalisedSegment[]): BookingKey {
  const first = segments[0];
  const tz = first.departTz ?? "UTC";
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(first.departUtc));
  return {
    origin: first.origin,
    dest: segments[segments.length - 1].dest,
    date,
    carrier: first.carrier,
    flightNumber: first.flightNumber,
    flights: segments.map((s) => `${s.carrier ?? ""}${s.flightNumber ?? ""}`),
  };
}

// ---------- Provider ----------

export function aviasalesConfigured(): boolean {
  return !!process.env.TRAVELPAYOUTS_TOKEN && !!process.env.TRAVELPAYOUTS_MARKER;
}

/**
 * A fresh SubID for one booking link: letters and digits only (Travelpayouts rejects
 * hyphens), short, and unique enough to match a booking back to the click.
 */
export function newSubId(now = Date.now(), random = Math.random): string {
  const rand = Array.from({ length: 4 }, () => Math.floor(random() * 36).toString(36)).join("");
  return `c${now.toString(36)}${rand}`;
}

/** Travelpayouts reads "partnerId.subId": the SubID goes after the partner ID, separated by a dot. */
export function markerWithSubId(marker: string, subId?: string): string {
  return subId && /^[A-Za-z0-9_]+$/.test(subId) ? `${marker}.${subId}` : marker;
}

/** The search body without user details or signature: also the cache identity (no IPs in the cache table). */
function searchKey(directions: { origin: string; destination: string; date: string }[], f: SearchFilters) {
  return {
    trip_class: "Y",
    passengers: { adults: f.adults, children: f.children, infants: f.infants ?? 0 },
    segments: directions,
  };
}

function signedBody(key: ReturnType<typeof searchKey>, client: AviasalesClient) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  const marker = process.env.TRAVELPAYOUTS_MARKER;
  if (!token || !marker) throw new ProviderError("TRAVELPAYOUTS_TOKEN / TRAVELPAYOUTS_MARKER are not set on the server", null, "missing_api_key");
  const body: Record<string, unknown> = { marker, host: client.host, user_ip: client.ip, locale: "en", know_english: "true", ...key };
  return { ...body, signature: sign(token, body) };
}

export function createAviasalesProvider(client: AviasalesClient): FlightProvider {
  async function search(directions: { origin: string; destination: string; date: string }[], filters: SearchFilters, ctx: CallContext, label: string) {
    const key = searchKey(directions, filters);
    const res = await ctx.call({
      provider: "aviasales",
      endpoint: "/v1/flight_search",
      body: key,
      label,
      ttlMins: CACHE_MINS,
      fetcher: () => runAviasalesSearch(signedBody(key, client)),
    });
    return normaliseSearch(res.raw as AviasalesSearch, { filters, origin: directions[0].origin, fetchedAt: res.fetchedAt, fromCache: res.fromCache });
  }

  return {
    id: "aviasales",

    async searchOneWay(origin, dest, date, filters, ctx) {
      const r = await search([{ origin, destination: dest, date }], filters, ctx, `${origin}→${dest} ${date} (Aviasales)`);
      return r.map((x) => x.out);
    },

    async searchRoundTrip(origin, dest, date, returnDate, filters, ctx): Promise<NormalisedRoundTrip[]> {
      const r = await search(
        [
          { origin, destination: dest, date },
          { origin: dest, destination: origin, date: returnDate },
        ],
        filters,
        ctx,
        `${origin}⇄${dest} ${date}/${returnDate} (Aviasales)`,
      );
      return r.filter((x): x is NormalisedRoundTrip => !!x.back);
    },

    // Only ever called when the user taps "Get booking links" (the API terms forbid fetching them in bulk).
    async getBookingLinks(providerRef, _filters, ctx, _key, subId) {
      const ref = parseRef(providerRef);
      if (!ref) throw new ProviderError("Not an Aviasales fare", 400);
      const marker = markerWithSubId(process.env.TRAVELPAYOUTS_MARKER ?? "", subId);
      const path = `/v1/flight_searches/${encodeURIComponent(ref.searchId)}/clicks/${encodeURIComponent(ref.url)}.json?marker=${encodeURIComponent(marker)}`;
      let raw: { url?: string; method?: string };
      try {
        const res = await ctx.call({ provider: "aviasales", endpoint: "/v1/flight_searches/clicks", body: { ref: providerRef }, label: `booking link ${ref.seller || "Aviasales"}`, ttlMins: 0, fetcher: () => asFetch(path, { userIp: client.ip }) });
        raw = res.raw as typeof raw;
      } catch (err) {
        if (err instanceof ProviderError && (err.httpStatus === 404 || err.httpStatus === 410))
          throw new ProviderError("This price has expired (Aviasales prices last 15 minutes). Search again for a fresh link.", err.httpStatus, "expired");
        throw err;
      }
      if (!raw.url || (raw.method && raw.method.toUpperCase() !== "GET")) return [];
      const link: BookingLink = { providerName: ref.seller || "Aviasales partner", providerType: null, exactFlight: true, fareName: null, price: null, url: raw.url };
      return [link];
    },

    // v1 has no market setting (it follows the user's location), so there's nothing to look up.
    async getMarketBookingLinks() {
      return [];
    },
  };
}
