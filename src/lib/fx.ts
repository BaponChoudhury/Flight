// Exchange rates for converting foreign-market prices to GBP.
//
// Source: open.er-api.com (free, no key, mid-market, refreshed daily) — the closest
// free equivalent of the rate Google shows. Cached in the store for 6 hours.
// Deliberately NO fallback to stale or configured rates: if live rates are
// unavailable we don't offer foreign-market prices at all, rather than risk
// quoting below cost.

import type { Store } from "@/lib/store";

export interface GbpRates {
  /** Units of each currency per 1 GBP, mid-market. */
  rates: Record<string, number>;
  fetchedAt: string;
  source: string;
}

const SOURCE_URL = "https://open.er-api.com/v6/latest/GBP";
const KV_KEY = "fx_gbp_rates_v1";
const MAX_AGE_MS = 6 * 3_600_000;

type Fetcher = () => Promise<GbpRates>;

async function fetchRates(): Promise<GbpRates> {
  const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`FX source HTTP ${res.status}`);
  const body = (await res.json()) as { result?: string; base_code?: string; rates?: Record<string, number> };
  if (body.result !== "success" || body.base_code !== "GBP" || !body.rates?.INR) throw new Error("FX source returned an unexpected payload");
  return { rates: body.rates, fetchedAt: new Date().toISOString(), source: "open.er-api.com" };
}

/** Live GBP rates, or null when they can't be obtained (callers must then skip FX-dependent offers). */
export async function getGbpRates(store: Store, fetcher: Fetcher = fetchRates): Promise<GbpRates | null> {
  const cached = await store.getKv<GbpRates>(KV_KEY);
  if (cached && Date.now() - Date.parse(cached.value.fetchedAt) < MAX_AGE_MS) return cached.value;
  try {
    const fresh = await fetcher();
    await store.putKv(KV_KEY, fresh);
    return fresh;
  } catch (err) {
    console.warn(`FX rates unavailable: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Convert a foreign amount to GBP using the mid-market rate less a margin.
 * A lower rate (fewer units per £) means more £ per foreign unit, so the margin
 * always works in our favour: 126.5 INR/£ at 0.4% → 125.994 INR/£.
 */
export function toGbpWithMargin(amount: number, currency: string, fx: GbpRates, marginPct: number): number | null {
  if (currency === "GBP") return Math.round(amount * 100) / 100;
  const mid = fx.rates[currency];
  if (!mid || mid <= 0) return null;
  const applied = mid * (1 - marginPct / 100);
  return Math.ceil((amount / applied) * 100) / 100; // round up: never quote below cost
}
