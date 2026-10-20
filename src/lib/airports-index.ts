// World airport index from OurAirports (public domain, no key):
// https://github.com/davidmegginson/ourairports-data
// Downloaded server-side, reduced to airports with scheduled service and an
// IATA code (~4,000), cached in the store and in memory, refreshed monthly.

import type { Store } from "@/lib/store";

export interface AirportRecord {
  code: string; // IATA
  name: string;
  city: string;
  country: string; // ISO 3166-1 alpha-2
  lat: number;
  lon: number;
}

const SOURCE_URL = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv";
const KV_KEY = "airport_index_v1";
const MAX_AGE_MS = 30 * 86_400_000;

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, commas/newlines in quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function buildIndex(csv: string): AirportRecord[] {
  const [header, ...rows] = parseCsv(csv);
  const col = (n: string) => header.indexOf(n);
  const [iType, iName, iLat, iLon, iCountry, iCity, iSched, iIata] = [
    "type", "name", "latitude_deg", "longitude_deg", "iso_country", "municipality", "scheduled_service", "iata_code",
  ].map(col);
  const out: AirportRecord[] = [];
  for (const r of rows) {
    const code = r[iIata]?.trim();
    if (!code || !/^[A-Z]{3}$/.test(code) || r[iSched] !== "yes") continue;
    if (!["large_airport", "medium_airport", "small_airport"].includes(r[iType])) continue;
    out.push({ code, name: r[iName], city: r[iCity] || r[iName], country: r[iCountry], lat: Number(r[iLat]), lon: Number(r[iLon]) });
  }
  return out;
}

const g = globalThis as unknown as { __airportIndex?: { at: number; records: AirportRecord[] } };

export async function getAirportIndex(store: Store, fetchCsv: () => Promise<string> = defaultFetch): Promise<AirportRecord[]> {
  if (g.__airportIndex && Date.now() - g.__airportIndex.at < MAX_AGE_MS) return g.__airportIndex.records;
  const saved = await store.getKv<AirportRecord[]>(KV_KEY);
  if (saved && Date.now() - Date.parse(saved.updated_at) < MAX_AGE_MS && saved.value.length) {
    g.__airportIndex = { at: Date.parse(saved.updated_at), records: saved.value };
    return saved.value;
  }
  try {
    const records = buildIndex(await fetchCsv());
    if (records.length < 1000) throw new Error(`airport list looks wrong (${records.length} rows)`);
    await store.putKv(KV_KEY, records);
    g.__airportIndex = { at: Date.now(), records };
    return records;
  } catch (err) {
    // Serve a stale copy rather than nothing.
    if (saved?.value.length) return saved.value;
    throw err;
  }
}

async function defaultFetch(): Promise<string> {
  const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!res.ok) throw new Error(`OurAirports download failed: HTTP ${res.status}`);
  return res.text();
}

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Rank: exact code, then city/name prefix, then word prefix, then substring. */
export function searchAirports(index: AirportRecord[], q: string, opts: { country?: string; limit?: number } = {}): AirportRecord[] {
  const query = norm(q.trim());
  if (!query) return [];
  const pool = opts.country ? index.filter((a) => a.country === opts.country) : index;
  const scored: { a: AirportRecord; s: number }[] = [];
  for (const a of pool) {
    const city = norm(a.city);
    const name = norm(a.name);
    let s = -1;
    if (a.code.toLowerCase() === query) s = 0;
    else if (city.startsWith(query)) s = 1;
    else if (name.startsWith(query)) s = 2;
    else if (city.split(/[\s-]+/).some((w) => w.startsWith(query)) || name.split(/[\s-]+/).some((w) => w.startsWith(query))) s = 3;
    else if (city.includes(query) || name.includes(query)) s = 4;
    if (s >= 0) scored.push({ a, s });
  }
  return scored.sort((x, y) => x.s - y.s || x.a.city.localeCompare(y.a.city)).slice(0, opts.limit ?? 8).map((x) => x.a);
}
