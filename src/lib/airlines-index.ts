// Airline IATA code → home country (ISO alpha-2), from the free OpenFlights airline list
// (https://github.com/jpatokal/openflights) with country names mapped to codes via
// OurAirports' countries.csv. Cached in the store for 30 days. The list is dated
// (e.g. QP is now Akasa Air, India), so `airline_country_overrides` in settings wins.

import { parseCsv } from "@/lib/airports-index";
import type { Store } from "@/lib/store";

const AIRLINES_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat";
const COUNTRIES_URL = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/countries.csv";
const KV_KEY = "airline_countries_v1";
const MAX_AGE_MS = 30 * 86_400_000;

export function buildAirlineCountries(airlinesDat: string, countriesCsv: string): Record<string, string> {
  const [header, ...countryRows] = parseCsv(countriesCsv);
  const code = header.indexOf("code");
  const name = header.indexOf("name");
  const byName = new Map(countryRows.filter((r) => r[code]).map((r) => [r[name], r[code]]));
  const out: Record<string, string> = {};
  // airlines.dat columns: id, name, alias, IATA, ICAO, callsign, country, active
  for (const r of parseCsv(airlinesDat)) {
    const iata = r[3]?.trim();
    if (!iata || !/^[A-Z0-9]{2}$/.test(iata) || r[7] !== "Y" || out[iata]) continue;
    if (/cargo/i.test(r[1] ?? "")) continue;
    const country = byName.get(r[6]);
    if (country) out[iata] = country;
  }
  return out;
}

const g = globalThis as unknown as { __airlineCountries?: { at: number; map: Record<string, string> } };

async function download(): Promise<Record<string, string>> {
  const get = async (url: string) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.text();
  };
  const [airlines, countries] = await Promise.all([get(AIRLINES_URL), get(COUNTRIES_URL)]);
  return buildAirlineCountries(airlines, countries);
}

/** Map of airline code → country, or an empty map if it can't be loaded (callers then skip the airline market). */
export async function getAirlineCountries(store: Store, fetcher: () => Promise<Record<string, string>> = download): Promise<Record<string, string>> {
  if (g.__airlineCountries && Date.now() - g.__airlineCountries.at < MAX_AGE_MS) return g.__airlineCountries.map;
  const saved = await store.getKv<Record<string, string>>(KV_KEY);
  if (saved && Date.now() - Date.parse(saved.updated_at) < MAX_AGE_MS && Object.keys(saved.value).length) {
    g.__airlineCountries = { at: Date.parse(saved.updated_at), map: saved.value };
    return saved.value;
  }
  try {
    const map = await fetcher();
    if (Object.keys(map).length < 300) throw new Error("airline list looks wrong");
    await store.putKv(KV_KEY, map);
    g.__airlineCountries = { at: Date.now(), map };
    return map;
  } catch (err) {
    console.warn(`airline countries unavailable: ${(err as Error).message}`);
    return saved?.value ?? {};
  }
}
