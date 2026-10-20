// Domain types shared by the search engine, API routes and UI.
// All instants are ISO-8601 UTC strings; local times are derived for display only.

export type ProviderId = "ignav" | "duffel";
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
  observedAt: string | null;
  fetchedAt: string;
  fromCache: boolean;
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
  originArea: string;
  dest: string;
  date: string; // YYYY-MM-DD, UK local departure date
  flexDays: 0 | 1;
  adults: number;
  children: number;
  bags: number; // checked bags per passenger
  bagKg: number; // weight of each bag
  earliestDepartHour?: number | null; // UK local
  latestArriveHour?: number | null; // destination local
  minBufferMins?: number | null;
  allowOvernight?: boolean;
  ukAirports?: string[] | null;
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
  | "Price not confirmed";

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
  totalMins: number;
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
