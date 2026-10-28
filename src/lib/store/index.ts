// Persistence. Uses Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
// set; otherwise an in-process memory store (fine for local dev, not durable).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { defaultConfig, DEFAULT_SETTINGS } from "@/lib/config/defaults";
import type { AppConfig, CallLogEntry, HubRoute, SearchRequest, Settings } from "@/lib/types";
import type { TripFollowup } from "@/lib/followups";

export const CONFIG_TABLES = {
  airports: { key: "airports", pk: ["iata"] },
  ground_access: { key: "groundAccess", pk: ["origin_area", "airport", "mode"] },
  bag_fees: { key: "bagFees", pk: ["airline_code", "route_type", "bag_kg"] },
  airline_bag_defaults: { key: "airlineBagDefaults", pk: ["airline_code", "route_type"] },
  airline_terminals: { key: "airlineTerminals", pk: ["airport", "airline_code", "route_type"] },
  terminal_rules: { key: "terminalRules", pk: ["airport", "from_terminal", "to_terminal"] },
  hub_routes: { key: "hubRoutes", pk: ["hub", "dest"] },
} as const;
export type ConfigTable = keyof typeof CONFIG_TABLES;
type Row = Record<string, unknown>;

export interface CacheRow {
  cache_key: string;
  provider: string;
  endpoint: string;
  request: unknown;
  raw_response: unknown;
  fetched_at: string;
  expires_at: string;
}

export interface SearchLog {
  id: string;
  params: SearchRequest;
  paid_calls: number;
  cache_hits: number;
  failed_calls: number;
  result_count: number;
  duration_ms: number;
}

export interface FareQuote {
  id: string;
  created_at: string;
  expires_at: string;
  market: string;
  provider_name: string;
  booking_url: string;
  fare_name: string | null;
  local_amount: number;
  local_currency: string;
  mid_rate: number;
  applied_rate: number;
  price_gbp: number;
  uk_price_gbp: number | null;
  passengers: { adults: number; children: number; infants: number };
  itinerary: unknown;
}

/** An Aviasales booking link given to a user, tagged with its own Travelpayouts SubID. */
export interface BookingClick {
  sub_id: string;
  created_at: string;
  provider: string;
  seller: string | null;
  search_id: string | null;
  origin: string | null;
  dest: string | null;
  depart_date: string | null;
  return_date: string | null;
  flights: string | null;
  price_gbp: number | null;
  passengers: { adults: number; children: number; infants: number };
}

export interface FareRequest {
  id: string;
  quote_id: string;
  created_at: string;
  status: "new" | "contacted" | "booked" | "cancelled";
  contact: { name: string; email: string; phone: string };
  notes: string | null;
}

export interface Member {
  user_id: string;
  email: string;
  marketing_opt_in: boolean;
  marketing_consent_at: string | null;
  created_at: string;
  last_login_at: string;
}

export interface Store {
  kind: "supabase" | "memory";
  loadConfig(): Promise<AppConfig>;
  getTable(table: ConfigTable): Promise<Row[]>;
  replaceTable(table: ConfigTable, rows: Row[]): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
  upsertHubRoutes(rows: HubRoute[]): Promise<void>;
  getCache(key: string): Promise<CacheRow | null>;
  /** Small key/value blobs (e.g. the compact airport index). */
  getKv<T>(key: string): Promise<{ value: T; updated_at: string } | null>;
  putKv(key: string, value: unknown): Promise<void>;
  saveQuote(q: FareQuote): Promise<void>;
  getQuote(id: string): Promise<FareQuote | null>;
  createFareRequest(r: FareRequest): Promise<void>;
  listFareRequests(limit?: number): Promise<(FareRequest & { quote: FareQuote | null })[]>;
  logBookingClick(c: BookingClick): Promise<void>;
  createFollowup(f: TripFollowup): Promise<void>;
  /** Follow-ups due on or before `date` (yyyy-mm-dd), not yet sent or unsubscribed. */
  listDueFollowups(date: string, limit?: number): Promise<TripFollowup[]>;
  /** Marks a follow-up sent and wipes its email address. */
  markFollowupSent(id: string): Promise<void>;
  /** Unsubscribes by the link's token and wipes the email address; false if the token is unknown. */
  unsubscribeFollowup(token: string): Promise<boolean>;
  listFollowups(limit?: number): Promise<TripFollowup[]>;
  /** Records a sign-in. Marketing consent only ever switches on here, never off (unsubscribe does that). */
  upsertMember(m: { user_id: string; email: string; marketing_opt_in: boolean }): Promise<void>;
  listMembers(limit?: number): Promise<Member[]>;
  listBookingClicks(limit?: number): Promise<BookingClick[]>;
  putCache(row: CacheRow): Promise<void>;
  logSearch(search: SearchLog, calls: CallLogEntry[]): Promise<void>;
}

function normaliseQuote(row: Record<string, unknown>): FareQuote {
  const n = (k: string) => (row[k] == null ? null : Number(row[k]));
  return {
    ...(row as unknown as FareQuote),
    local_amount: n("local_amount")!,
    mid_rate: n("mid_rate")!,
    applied_rate: n("applied_rate")!,
    price_gbp: n("price_gbp")!,
    uk_price_gbp: n("uk_price_gbp"),
  };
}

function mergeSettings(rows: { key: string; value: unknown }[]): Settings {
  const s = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  for (const r of rows) if (r.key in s) s[r.key] = r.value;
  return s as unknown as Settings;
}

// ---------- Memory ----------

class MemoryStore implements Store {
  kind = "memory" as const;
  private config = defaultConfig();
  private cache = new Map<string, CacheRow>();
  private kv = new Map<string, { value: unknown; updated_at: string }>();
  private quotes = new Map<string, FareQuote>();
  private requests: FareRequest[] = [];
  private clicks: BookingClick[] = [];
  private followups: TripFollowup[] = [];
  private members: Member[] = [];

  async saveQuote(q: FareQuote) {
    this.quotes.set(q.id, structuredClone(q));
  }
  async getQuote(id: string) {
    return structuredClone(this.quotes.get(id) ?? null);
  }
  async createFareRequest(r: FareRequest) {
    this.requests.push(structuredClone(r));
  }
  async listFareRequests(limit = 100) {
    return [...this.requests]
      .reverse()
      .slice(0, limit)
      .map((r) => ({ ...structuredClone(r), quote: structuredClone(this.quotes.get(r.quote_id) ?? null) }));
  }

  async logBookingClick(c: BookingClick) {
    this.clicks.push(structuredClone(c));
  }
  async createFollowup(f: TripFollowup) {
    this.followups.push(structuredClone(f));
  }
  async listDueFollowups(date: string, limit = 100) {
    return structuredClone(this.followups.filter((f) => f.send_after <= date && !f.sent_at && !f.unsubscribed_at && f.email).slice(0, limit));
  }
  async markFollowupSent(id: string) {
    const f = this.followups.find((x) => x.id === id);
    if (f) Object.assign(f, { sent_at: new Date().toISOString(), email: null });
  }
  async unsubscribeFollowup(token: string) {
    const f = this.followups.find((x) => x.unsubscribe_token === token);
    if (!f) return false;
    Object.assign(f, { unsubscribed_at: f.unsubscribed_at ?? new Date().toISOString(), email: null });
    return true;
  }
  async listFollowups(limit = 200) {
    return structuredClone([...this.followups].reverse().slice(0, limit));
  }
  async upsertMember(m: { user_id: string; email: string; marketing_opt_in: boolean }) {
    const now = new Date().toISOString();
    const prev = this.members.find((x) => x.user_id === m.user_id);
    if (prev) Object.assign(prev, { email: m.email, last_login_at: now }, m.marketing_opt_in && !prev.marketing_opt_in ? { marketing_opt_in: true, marketing_consent_at: now } : {});
    else this.members.push({ ...m, marketing_consent_at: m.marketing_opt_in ? now : null, created_at: now, last_login_at: now });
  }
  async listMembers(limit = 500) {
    return structuredClone([...this.members].reverse().slice(0, limit));
  }
  async listBookingClicks(limit = 200) {
    return structuredClone([...this.clicks].reverse().slice(0, limit));
  }

  async getKv<T>(key: string) {
    return (this.kv.get(key) as { value: T; updated_at: string } | undefined) ?? null;
  }
  async putKv(key: string, value: unknown) {
    this.kv.set(key, { value, updated_at: new Date().toISOString() });
  }

  async loadConfig() {
    return structuredClone(this.config);
  }
  async getTable(table: ConfigTable) {
    return structuredClone(this.config[CONFIG_TABLES[table].key]) as unknown as Row[];
  }
  async replaceTable(table: ConfigTable, rows: Row[]) {
    (this.config as unknown as Record<string, unknown>)[CONFIG_TABLES[table].key] = structuredClone(rows);
  }
  async saveSettings(settings: Settings) {
    this.config.settings = structuredClone(settings);
  }
  async upsertHubRoutes(rows: HubRoute[]) {
    for (const r of rows) {
      const i = this.config.hubRoutes.findIndex((h) => h.hub === r.hub && h.dest === r.dest);
      if (i >= 0) this.config.hubRoutes[i] = r;
      else this.config.hubRoutes.push(r);
    }
  }
  async getCache(key: string) {
    return this.cache.get(key) ?? null;
  }
  async putCache(row: CacheRow) {
    this.cache.set(row.cache_key, row);
  }
  async logSearch(search: SearchLog, calls: CallLogEntry[]) {
    console.info(
      `[search ${search.id}] paid=${search.paid_calls} cacheHits=${search.cache_hits} failed=${search.failed_calls} results=${search.result_count} ${search.duration_ms}ms (${calls.length} calls)`,
    );
  }
}

// ---------- Supabase ----------

class SupabaseStore implements Store {
  kind = "supabase" as const;
  constructor(private db: SupabaseClient) {}

  private async select(table: string): Promise<Row[]> {
    const { data, error } = await this.db.from(table).select("*");
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
    return data ?? [];
  }

  async loadConfig(): Promise<AppConfig> {
    const [airports, ground, bagFees, bagDefaults, terminals, rules, hubRoutes, settings] = await Promise.all([
      this.select("airports"),
      this.select("ground_access"),
      this.select("bag_fees"),
      this.select("airline_bag_defaults"),
      this.select("airline_terminals"),
      this.select("terminal_rules"),
      this.select("hub_routes"),
      this.select("settings"),
    ]);
    const num = <T extends Row>(rows: Row[], fields: string[]) =>
      rows.map((r) => {
        const o = { ...r };
        for (const f of fields) if (o[f] != null) o[f] = Number(o[f]);
        return o as T;
      });
    return {
      airports: airports as unknown as AppConfig["airports"],
      groundAccess: num(ground, ["cost_gbp", "duration_mins"]) as unknown as AppConfig["groundAccess"],
      bagFees: num(bagFees, ["bag_kg", "fee_gbp"]) as unknown as AppConfig["bagFees"],
      airlineBagDefaults: num(bagDefaults, ["included_pieces", "included_kg", "excess_per_kg_gbp"]) as unknown as AppConfig["airlineBagDefaults"],
      airlineTerminals: terminals as unknown as AppConfig["airlineTerminals"],
      terminalRules: num(rules, ["extra_mins"]) as unknown as AppConfig["terminalRules"],
      hubRoutes: hubRoutes as unknown as AppConfig["hubRoutes"],
      settings: mergeSettings(settings as { key: string; value: unknown }[]),
    };
  }

  async getTable(table: ConfigTable) {
    return this.select(table);
  }

  async replaceTable(table: ConfigTable, rows: Row[]) {
    // Small config tables: delete-all then insert keeps the admin editor simple.
    const pk = CONFIG_TABLES[table].pk[0];
    const del = await this.db.from(table).delete().not(pk, "is", null);
    if (del.error) throw new Error(`Supabase ${table}: ${del.error.message}`);
    if (rows.length) {
      const ins = await this.db.from(table).insert(rows);
      if (ins.error) throw new Error(`Supabase ${table}: ${ins.error.message}`);
    }
  }

  async saveSettings(settings: Settings) {
    const rows = Object.entries(settings).map(([key, value]) => ({ key, value }));
    const { error } = await this.db.from("settings").upsert(rows);
    if (error) throw new Error(`Supabase settings: ${error.message}`);
  }

  async upsertHubRoutes(rows: HubRoute[]) {
    if (!rows.length) return;
    const { error } = await this.db.from("hub_routes").upsert(rows);
    if (error) console.warn(`hub_routes upsert failed: ${error.message}`);
  }

  async saveQuote(q: FareQuote) {
    const { error } = await this.db.from("fare_quotes").insert(q);
    if (error) throw new Error(`fare_quotes insert failed (run supabase/migrations/0004_fare_quotes.sql?): ${error.message}`);
  }

  async getQuote(id: string) {
    const { data, error } = await this.db.from("fare_quotes").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`fare_quotes read failed: ${error.message}`);
    return data ? normaliseQuote(data) : null;
  }

  async createFareRequest(r: FareRequest) {
    const { error } = await this.db.from("fare_requests").insert(r);
    if (error) throw new Error(`fare_requests insert failed: ${error.message}`);
  }

  async listFareRequests(limit = 100) {
    const { data, error } = await this.db
      .from("fare_requests")
      .select("*, quote:fare_quotes(*)")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`fare_requests read failed: ${error.message}`);
    return (data ?? []).map((r) => ({ ...(r as FareRequest), quote: r.quote ? normaliseQuote(r.quote) : null }));
  }

  async logBookingClick(c: BookingClick) {
    const { error } = await this.db.from("booking_clicks").insert(c);
    if (error) throw new Error(`booking_clicks insert failed (run supabase/migrations/0005_booking_clicks.sql?): ${error.message}`);
  }

  async createFollowup(f: TripFollowup) {
    const { error } = await this.db.from("trip_followups").insert(f);
    if (error) throw new Error(`trip_followups insert failed (run supabase/migrations/0006_trip_followups.sql?): ${error.message}`);
  }

  async listDueFollowups(date: string, limit = 100) {
    const { data, error } = await this.db
      .from("trip_followups")
      .select("*")
      .lte("send_after", date)
      .is("sent_at", null)
      .is("unsubscribed_at", null)
      .not("email", "is", null)
      .order("send_after")
      .limit(limit);
    if (error) throw new Error(`trip_followups read failed: ${error.message}`);
    return (data ?? []) as TripFollowup[];
  }

  async markFollowupSent(id: string) {
    const { error } = await this.db.from("trip_followups").update({ sent_at: new Date().toISOString(), email: null }).eq("id", id);
    if (error) throw new Error(`trip_followups update failed: ${error.message}`);
  }

  async unsubscribeFollowup(token: string) {
    const { data, error } = await this.db
      .from("trip_followups")
      .update({ unsubscribed_at: new Date().toISOString(), email: null })
      .eq("unsubscribe_token", token)
      .select("id");
    if (error) throw new Error(`trip_followups update failed: ${error.message}`);
    return (data ?? []).length > 0;
  }

  async upsertMember(m: { user_id: string; email: string; marketing_opt_in: boolean }) {
    const now = new Date().toISOString();
    const { data: prev, error: readError } = await this.db.from("members").select("marketing_opt_in").eq("user_id", m.user_id).maybeSingle();
    if (readError) throw new Error(`members read failed (run supabase/migrations/0007_members.sql?): ${readError.message}`);
    const row: Partial<Member> = { user_id: m.user_id, email: m.email, last_login_at: now };
    if (m.marketing_opt_in && !prev?.marketing_opt_in) Object.assign(row, { marketing_opt_in: true, marketing_consent_at: now });
    const { error } = await this.db.from("members").upsert(row, { onConflict: "user_id" });
    if (error) throw new Error(`members upsert failed: ${error.message}`);
  }

  async listMembers(limit = 500) {
    const { data, error } = await this.db.from("members").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`members read failed (run supabase/migrations/0007_members.sql?): ${error.message}`);
    return (data ?? []) as Member[];
  }

  async listFollowups(limit = 200) {
    const { data, error } = await this.db.from("trip_followups").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`trip_followups read failed (run supabase/migrations/0006_trip_followups.sql?): ${error.message}`);
    return (data ?? []) as TripFollowup[];
  }

  async listBookingClicks(limit = 200) {
    const { data, error } = await this.db.from("booking_clicks").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`booking_clicks read failed (run supabase/migrations/0005_booking_clicks.sql?): ${error.message}`);
    return (data ?? []).map((r) => ({ ...(r as BookingClick), price_gbp: r.price_gbp == null ? null : Number(r.price_gbp) }));
  }

  async getKv<T>(key: string) {
    const { data, error } = await this.db.from("kv").select("value, updated_at").eq("key", key).maybeSingle();
    if (error) {
      console.warn(`kv read failed (run supabase/migrations/0003_kv.sql?): ${error.message}`);
      return null;
    }
    return (data as { value: T; updated_at: string } | null) ?? null;
  }

  async putKv(key: string, value: unknown) {
    const { error } = await this.db.from("kv").upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) console.warn(`kv write failed: ${error.message}`);
  }

  async getCache(key: string) {
    const { data, error } = await this.db.from("fare_cache").select("*").eq("cache_key", key).maybeSingle();
    if (error) {
      console.warn(`fare_cache read failed: ${error.message}`);
      return null;
    }
    return (data as CacheRow | null) ?? null;
  }

  async putCache(row: CacheRow) {
    const { error } = await this.db.from("fare_cache").upsert(row);
    if (error) console.warn(`fare_cache write failed: ${error.message}`);
  }

  async logSearch(search: SearchLog, calls: CallLogEntry[]) {
    const s = await this.db.from("searches").insert(search);
    if (s.error) return console.warn(`searches insert failed: ${s.error.message}`);
    if (!calls.length) return;
    const c = await this.db.from("api_calls").insert(
      calls.map((c) => ({
        search_id: search.id,
        provider: c.provider,
        endpoint: c.endpoint,
        label: c.label,
        cache_hit: c.cacheHit,
        ok: c.ok,
        http_status: c.httpStatus,
        latency_ms: c.latencyMs,
        error: c.error ?? null,
      })),
    );
    if (c.error) console.warn(`api_calls insert failed: ${c.error.message}`);
  }
}

export function createMemoryStore(): Store {
  return new MemoryStore();
}

const g = globalThis as unknown as { __flightStore?: Store };

export function getStore(): Store {
  if (g.__flightStore) return g.__flightStore;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  g.__flightStore =
    url && key
      ? new SupabaseStore(createClient(url, key, { auth: { persistSession: false } }))
      : new MemoryStore();
  return g.__flightStore;
}
