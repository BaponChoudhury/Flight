// Domain types shared by the search engine, API routes and UI.
// All instants are ISO-8601 UTC strings; local times are derived for display only.

export type ProviderId = "ignav" | "aviasales" | "duffel";
export type RouteType = "international" | "domestic";

// ---------- Config tables ----------

export interface Airport {
  iata: string;
  name: string;
  city: string;
  tz: string; // IANA timezone, e.g. "Europe/London"
  role: "uk_origin" | "india_hub" | "destination";
  enabled: boolean;
}

export interface GroundAccess {
  origin_area: string;
  airport: string;
  mode: string;
  cost_gbp: number;
  per_person: boolean; // true: cost_gbp is per traveller (train); false: per party (car/taxi)
  duration_mins: number;
  notes: string;
}

export interface BagFee {
  airline_code: string; // "*" = any airline
  route_type: RouteType;
  bag_kg: number;
  fee_gbp: number; // per bag, per passenger
  notes: string;
}

export interface AirlineBagDefault {
  airline_code: string; // "*" = any airline
  route_type: RouteType;
  included_pieces: number | null; // used only when the provider gives no bag count
  included_kg: number | null; // per piece
  excess_per_kg_gbp: number | null;
  notes: string;
}

export interface AirlineTerminal {
  airport: string;
  airline_code: string; // "*" = any airline
  route_type: RouteType;
  terminal: string;
}

export interface TerminalRule {
  airport: string;
  from_terminal: string;
  to_terminal: string;
  extra_mins: number;
}

export interface HubRoute {
  hub: string;
  dest: string;
  has_service: boolean;
  last_checked_at: string;
}

export interface Settings {
  min_buffer_mins: number;
  max_buffer_mins: number;
  overnight_max_buffer_mins: number;
  uk_arrival_exit_mins: number; // landing in the UK → leaving the airport (immigration, bags)
  terminal_change_default_mins: number;
  hotel_gbp_default: number;
  hotel_gbp_by_hub: Record<string, number>;
  prune_factor: number;
  max_intl_per_group: number;
  max_domestic_per_intl: number;
  uk_airport_arrival_mins: number;
  cache_ttl_mins: number;
  market: string;
  fx_to_gbp: Record<string, number>;
  price_is_party_total: boolean;
  domestic_max_stops: number;
  hub_route_recheck_days: number;
  unknown_bag_penalty: number;
  max_parallel_calls: number;
  fx_margin_pct: number; // taken off the mid-market rate when converting foreign-market prices
  hidden_market_min_saving_gbp: number; // only offer a foreign-market price that beats the UK by at least this
  quote_ttl_mins: number;
  airline_country_overrides: Record<string, string>; // fixes for the open airline list, e.g. { QP: "IN" }
  hidden_markets_max: number; // foreign markets checked per tap (destination + airline home)
}

export interface AppConfig {
  airports: Airport[];
  groundAccess: GroundAccess[];
  bagFees: BagFee[];
  airlineBagDefaults: AirlineBagDefault[];
  airlineTerminals: AirlineTerminal[];
  terminalRules: TerminalRule[];
  hubRoutes: HubRoute[];
  settings: Settings;
}

// ---------- Provider output ----------

export interface NormalisedSegment {
  carrier: string | null; // marketing carrier IATA code
  carrierName: string | null; // operating carrier name
  flightNumber: string | null;
  origin: string;
  dest: string;
  departUtc: string;
  arriveUtc: string;
  departTz: string | null;
  arriveTz: string | null;
  durationMins: number;
  aircraft: string | null;
}

export interface NormalisedItinerary {
  provider: ProviderId;
  providerRef: string; // ignav_id
  origin: string;
  dest: string;
  departUtc: string;
  arriveUtc: string;
  durationMins: number;
  carrier: string | null; // IATA code of the first segment's marketing carrier
  carrierName: string | null;
  segments: NormalisedSegment[];
  price: {
    amount: number;
    currency: string;
    totalGbp: number; // whole party
    verified: boolean;
    fxApprox: boolean; // true when converted with a configured FX rate
  };
  baggage: {
    checkedPieces: number | null; // per passenger; null = unknown
    carryOnPieces: number | null;
  };
  selfTransfer: boolean;
  /** Refund and change rules, when the provider gives them (Aviasales does, Ignav doesn't). */
  fareTerms?: FareTerms | null;
  /** Booking site whose price this is, when known before booking links are fetched. */
  seller?: string | null;
  observedAt: string | null;
  fetchedAt: string;
  fromCache: boolean;
  /** How to find this whole Ignav itinerary again by flight details once the ignav_id expires. */
  bookingKey?: BookingKey;
}

export interface FareTerms {
  /** Refund before departure: true / false, or null when the seller doesn't say. */
  refundable: boolean | null;
  /** Fee for a refund before departure, whole party, in GBP; null = none stated. */
  refundFeeGbp: number | null;
  /** Date change before departure allowed. */
  changeable: boolean | null;
}

export interface BookingKey {
  origin: string;
  dest: string;
  date: string; // local departure date
  carrier: string | null; // first flight's marketing carrier
  flightNumber: string | null;
  /** Every flight of the leg ("GF8", "GF134"): lookups by flight details only send the first, so results are checked against this. */
  flights?: string[];
  ret?: { date: string; carrier: string | null; flightNumber: string | null; flights?: string[] };
}

/** A return fare: `out` carries the whole price, `back` has price 0 (included). Same providerRef. */
export interface NormalisedRoundTrip {
  out: NormalisedItinerary;
  back: NormalisedItinerary;
}

export interface BookingLink {
  providerName: string;
  providerType: string | null;
  exactFlight: boolean;
  fareName: string | null;
  price: { amount: number; currency: string } | null;
  url: string;
}

// ---------- Search ----------

export interface SearchRequest {
  originArea: string; // home town (UK mode); empty when departure airports were picked directly
  dest: string;
  date: string; // YYYY-MM-DD, UK local departure date
  returnDate?: string | null; // YYYY-MM-DD, date leaving the destination; empty = one-way
  flexDays: 0 | 1;
  adults: number;
  children: number; // 2–11
  infants?: number; // under 2, on a lap; no seat or bag
  bags: number; // checked bags per passenger (adults + children)
  bagKg?: number | null; // weight of each bag; optional
  earliestDepartHour?: number | null; // UK local
  latestArriveHour?: number | null; // destination local
  minBufferMins?: number | null;
  allowOvernight?: boolean;
  refundableOnly?: boolean; // only tickets refundable before departure (Aviasales fares; Ignav has no refund data)
  ukAirports?: string[] | null; // departure airports, any country, e.g. ["BHX", "MAN", "LON"] or ["FRA"]; city codes (LON, PAR) allowed
}

export interface BagAssessment {
  status: "included" | "fee" | "unknown" | "estimated";
  feeGbp: number;
  excessGbp: number;
  includedPieces: number | null;
  includedKg: number | null;
  excessRisk: boolean;
  note: string;
}

export interface FlightLeg {
  routeType: RouteType;
  itinerary: NormalisedItinerary;
  bag: BagAssessment;
  /** Sold together with the previous leg (Ignav self-transfer itinerary): price and booking are on that leg. */
  bundled?: boolean;
}

export interface Connection {
  airport: string;
  bufferMins: number;
  minRequiredMins: number;
  terminalChange: { from: string; to: string } | null;
  overnight: boolean;
  hotelGbp: number;
}

export type Badge =
  | "Separate tickets"
  | "Bags included"
  | "Bag price unknown"
  | "Terminal change"
  | "Overnight"
  | "Excess baggage risk"
  | "Price not confirmed"
  | "Refundable";

export interface ReturnJourney {
  legs: FlightLeg[];
  connection: Connection | null;
  leaveDestUtc: string;
  arriveUkUtc: string;
  arriveHomeUtc: string;
  totalMins: number; // leave destination → arrive home
}

export interface CostBreakdown {
  ground: number;
  fares: number[];
  bags: number;
  excessBaggage: number;
  hotel: number;
  total: number;
  bagsUnknown: boolean;
}

export interface RouteOption {
  id: string;
  kind: "through" | "split";
  ukAirport: string;
  hub: string | null;
  dest: string;
  ground: GroundAccess;
  legs: FlightLeg[];
  connection: Connection | null;
  costs: CostBreakdown;
  leaveHomeUtc: string;
  arriveUtc: string;
  outMins: number; // leave home → arrive at destination
  /** Return journey (destination → UK → home), or null for one-way. */
  back: ReturnJourney | null;
  totalMins: number; // outMins + back.totalMins
  badges: Badge[];
  priceAsOf: string; // earliest observed/fetched time across legs
}

export interface CallLogEntry {
  provider: ProviderId;
  endpoint: string;
  label: string;
  cacheHit: boolean;
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  error?: string;
}

export interface SearchResponse {
  searchId: string;
  options: RouteOption[];
  stats: {
    paidCalls: number;
    /** Paid calls per provider, e.g. { ignav: 40, aviasales: 3 }. */
    paidByProvider?: Partial<Record<ProviderId, number>>;
    cacheHits: number;
    failedCalls: number;
    durationMs: number;
    calls: CallLogEntry[];
  };
  errors: string[];
  notes: string[];
  airportTz: Record<string, string>;
  storage: "supabase" | "memory";
}
