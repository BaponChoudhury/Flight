// Seed configuration. Used when Supabase is not configured, and mirrored by
// supabase/migrations/0002_seed.sql. Every value here is editable from /admin.
// Rows marked "placeholder" are estimates to get started — check them.

import type {
  AirlineBagDefault,
  AirlineTerminal,
  Airport,
  AppConfig,
  BagFee,
  GroundAccess,
  Settings,
  TerminalRule,
} from "@/lib/types";

export const DEFAULT_AIRPORTS: Airport[] = [
  { iata: "BHX", name: "Birmingham", city: "Birmingham", tz: "Europe/London", role: "uk_origin", enabled: true },
  { iata: "MAN", name: "Manchester", city: "Manchester", tz: "Europe/London", role: "uk_origin", enabled: true },
  { iata: "LHR", name: "Heathrow", city: "London", tz: "Europe/London", role: "uk_origin", enabled: true },
  { iata: "LGW", name: "Gatwick", city: "London", tz: "Europe/London", role: "uk_origin", enabled: true },
  { iata: "DEL", name: "Indira Gandhi Intl", city: "Delhi", tz: "Asia/Kolkata", role: "india_hub", enabled: true },
  { iata: "BOM", name: "Chhatrapati Shivaji Maharaj Intl", city: "Mumbai", tz: "Asia/Kolkata", role: "india_hub", enabled: true },
  { iata: "BLR", name: "Kempegowda Intl", city: "Bengaluru", tz: "Asia/Kolkata", role: "india_hub", enabled: true },
  { iata: "CCU", name: "Netaji Subhas Chandra Bose Intl", city: "Kolkata", tz: "Asia/Kolkata", role: "india_hub", enabled: true },
  { iata: "HYD", name: "Rajiv Gandhi Intl", city: "Hyderabad", tz: "Asia/Kolkata", role: "india_hub", enabled: true },
  { iata: "MAA", name: "Chennai Intl", city: "Chennai", tz: "Asia/Kolkata", role: "india_hub", enabled: true },
  { iata: "AMD", name: "Sardar Vallabhbhai Patel Intl", city: "Ahmedabad", tz: "Asia/Kolkata", role: "india_hub", enabled: true },
  { iata: "COK", name: "Cochin Intl", city: "Kochi", tz: "Asia/Kolkata", role: "india_hub", enabled: true },
  { iata: "GAU", name: "Lokpriya Gopinath Bordoloi Intl", city: "Guwahati", tz: "Asia/Kolkata", role: "destination", enabled: true },
  { iata: "IXB", name: "Bagdogra", city: "Siliguri", tz: "Asia/Kolkata", role: "destination", enabled: true },
  { iata: "DIB", name: "Dibrugarh", city: "Dibrugarh", tz: "Asia/Kolkata", role: "destination", enabled: true },
  { iata: "IMF", name: "Imphal", city: "Imphal", tz: "Asia/Kolkata", role: "destination", enabled: true },
  { iata: "IXA", name: "Agartala", city: "Agartala", tz: "Asia/Kolkata", role: "destination", enabled: true },
];

const ga = (airport: string, mode: string, cost_gbp: number, duration_mins: number, notes: string): GroundAccess => ({
  origin_area: "Stafford",
  airport,
  mode,
  cost_gbp,
  per_person: true,
  duration_mins,
  notes,
});

export const DEFAULT_GROUND_ACCESS: GroundAccess[] = [
  ga("BHX", "train", 15, 60, "placeholder: Stafford → Birmingham Intl via New Street"),
  ga("MAN", "train", 20, 80, "placeholder: Stafford → Manchester Airport"),
  ga("LHR", "train", 40, 160, "placeholder: Stafford → Euston, then Elizabeth line"),
  ga("LGW", "train", 45, 190, "placeholder: Stafford → Euston, then Thameslink/Gatwick Express"),
];

export const DEFAULT_BAG_FEES: BagFee[] = [
  { airline_code: "*", route_type: "international", bag_kg: 23, fee_gbp: 70, notes: "placeholder: any airline without its own row" },
  { airline_code: "BA", route_type: "international", bag_kg: 23, fee_gbp: 65, notes: "placeholder: check airline site" },
  { airline_code: "VS", route_type: "international", bag_kg: 23, fee_gbp: 65, notes: "placeholder: check airline site" },
  { airline_code: "AI", route_type: "international", bag_kg: 23, fee_gbp: 60, notes: "placeholder: check airline site" },
  { airline_code: "6E", route_type: "domestic", bag_kg: 15, fee_gbp: 25, notes: "placeholder: prepaid extra bag" },
  { airline_code: "AI", route_type: "domestic", bag_kg: 15, fee_gbp: 25, notes: "placeholder: prepaid extra bag" },
];

export const DEFAULT_AIRLINE_BAG_DEFAULTS: AirlineBagDefault[] = [
  { airline_code: "*", route_type: "international", included_pieces: null, included_kg: 23, excess_per_kg_gbp: null, notes: "typical UK–India economy piece" },
  { airline_code: "*", route_type: "domestic", included_pieces: 1, included_kg: 15, excess_per_kg_gbp: 6, notes: "Indian domestic economy usually includes 1 × 15kg (assumed when Ignav gives no bag data); excess ≈ ₹600–700/kg (placeholder)" },
  { airline_code: "AI", route_type: "international", included_pieces: null, included_kg: 23, excess_per_kg_gbp: null, notes: "placeholder: verify" },
  { airline_code: "EK", route_type: "international", included_pieces: null, included_kg: 25, excess_per_kg_gbp: null, notes: "placeholder: weight concept, verify fare brand" },
  { airline_code: "QR", route_type: "international", included_pieces: null, included_kg: 25, excess_per_kg_gbp: null, notes: "placeholder: weight concept, verify fare brand" },
];

export const DEFAULT_AIRLINE_TERMINALS: AirlineTerminal[] = [
  { airport: "DEL", airline_code: "*", route_type: "international", terminal: "T3" },
  { airport: "DEL", airline_code: "AI", route_type: "domestic", terminal: "T3" },
  { airport: "DEL", airline_code: "6E", route_type: "domestic", terminal: "T1" },
  { airport: "DEL", airline_code: "QP", route_type: "domestic", terminal: "T1" },
  { airport: "DEL", airline_code: "SG", route_type: "domestic", terminal: "T1" },
  { airport: "BOM", airline_code: "*", route_type: "international", terminal: "T2" },
  { airport: "BOM", airline_code: "AI", route_type: "domestic", terminal: "T2" },
  { airport: "BOM", airline_code: "6E", route_type: "domestic", terminal: "T1" },
  { airport: "BOM", airline_code: "QP", route_type: "domestic", terminal: "T1" },
];

export const DEFAULT_TERMINAL_RULES: TerminalRule[] = [
  { airport: "DEL", from_terminal: "T3", to_terminal: "T1", extra_mins: 45 },
  { airport: "BOM", from_terminal: "T2", to_terminal: "T1", extra_mins: 45 },
];

export const DEFAULT_SETTINGS: Settings = {
  min_buffer_mins: 180,
  max_buffer_mins: 840,
  overnight_max_buffer_mins: 1440,
  terminal_change_default_mins: 45,
  hotel_gbp_default: 40,
  hotel_gbp_by_hub: {},
  prune_factor: 1.5,
  max_intl_per_group: 12,
  max_domestic_per_intl: 3,
  uk_airport_arrival_mins: 180,
  uk_arrival_exit_mins: 60,
  cache_ttl_mins: 120,
  market: "GB",
  fx_to_gbp: { GBP: 1, USD: 0.75, EUR: 0.85, INR: 0.0089 },
  price_is_party_total: true,
  domestic_max_stops: 1, // Ignav's direct-only domestic coverage is thin (e.g. no CCU→GAU directs)
  hub_route_recheck_days: 30,
  unknown_bag_penalty: 0.15,
  max_parallel_calls: 12,
};

export function defaultConfig(): AppConfig {
  return structuredClone({
    airports: DEFAULT_AIRPORTS,
    groundAccess: DEFAULT_GROUND_ACCESS,
    bagFees: DEFAULT_BAG_FEES,
    airlineBagDefaults: DEFAULT_AIRLINE_BAG_DEFAULTS,
    airlineTerminals: DEFAULT_AIRLINE_TERMINALS,
    terminalRules: DEFAULT_TERMINAL_RULES,
    hubRoutes: [],
    settings: DEFAULT_SETTINGS,
  });
}
