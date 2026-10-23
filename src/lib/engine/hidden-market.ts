// Hidden market check: look up the same flights as sold in another market (the
// destination country's), convert at the mid-market rate less our margin, and if
// it beats the UK price by enough, store a server-side quote. Users only ever see
// the GBP price and a quote id — never the market, seller, local price or link.

import { randomUUID } from "node:crypto";
import { getGbpRates, toGbpWithMargin, type GbpRates } from "@/lib/fx";
import type { CallContext, FlightProvider, SearchFilters } from "@/lib/providers/types";
import type { Store } from "@/lib/store";
import type { BookingKey, BookingLink, Settings } from "@/lib/types";

export interface LowerPrice {
  quoteId: string;
  priceGbp: number;
  ukPriceGbp: number | null;
  savingGbp: number | null;
  fareName: string | null;
  expiresAt: string;
}

export interface HiddenMarketArgs {
  provider: FlightProvider;
  ctx: CallContext;
  store: Store;
  settings: Settings;
  key: BookingKey;
  filters: SearchFilters;
  market: string;
  /** UK-market links for the same itinerary (may still be in flight; a failure counts as none). */
  ukLinks: BookingLink[] | Promise<BookingLink[]>;
  /** The itinerary's UK search price (whole party), used when no UK link carries a price. */
  ukSearchPriceGbp: number | null;
  fetchFx?: () => Promise<GbpRates>;
}

const priced = (l: BookingLink) => !!l.price && l.price.amount > 0;

export function cheapestUkGbp(links: BookingLink[]): number | null {
  const gbp = links.filter((l) => priced(l) && l.price!.currency === "GBP").map((l) => l.price!.amount);
  return gbp.length ? Math.min(...gbp) : null;
}

export async function checkHiddenMarket(a: HiddenMarketArgs): Promise<LowerPrice | null> {
  if (a.market === a.settings.market) return null;
  const fx = await getGbpRates(a.store, a.fetchFx);
  if (!fx) return null; // never quote foreign prices on stale or missing rates

  let foreign: BookingLink[];
  try {
    foreign = await a.provider.getMarketBookingLinks(a.key, a.filters, a.ctx, a.market);
  } catch (err) {
    console.warn(`hidden market ${a.market} lookup failed: ${(err as Error).message}`);
    return null;
  }

  let best: { link: BookingLink; gbp: number } | null = null;
  for (const link of foreign.filter(priced)) {
    const gbp = toGbpWithMargin(link.price!.amount, link.price!.currency, fx, a.settings.fx_margin_pct);
    if (gbp != null && (!best || gbp < best.gbp)) best = { link, gbp };
  }
  if (!best) return null;

  const ukLinks = await Promise.resolve(a.ukLinks).catch(() => [] as BookingLink[]);
  const uk = cheapestUkGbp(ukLinks) ?? a.ukSearchPriceGbp;
  if (uk != null && best.gbp > uk - a.settings.hidden_market_min_saving_gbp) return null;

  const currency = best.link.price!.currency;
  const mid = fx.rates[currency] ?? 1;
  const expiresAt = new Date(Date.now() + a.settings.quote_ttl_mins * 60_000).toISOString();
  const quoteId = `q_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await a.store.saveQuote({
    id: quoteId,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    market: a.market,
    provider_name: best.link.providerName,
    booking_url: best.link.url,
    fare_name: best.link.fareName,
    local_amount: best.link.price!.amount,
    local_currency: currency,
    mid_rate: mid,
    applied_rate: currency === "GBP" ? 1 : mid * (1 - a.settings.fx_margin_pct / 100),
    price_gbp: best.gbp,
    uk_price_gbp: uk,
    passengers: { adults: a.filters.adults, children: a.filters.children, infants: a.filters.infants ?? 0 },
    itinerary: a.key,
  });
  return {
    quoteId,
    priceGbp: best.gbp,
    ukPriceGbp: uk,
    savingGbp: uk != null ? Math.round((uk - best.gbp) * 100) / 100 : null,
    fareName: best.link.fareName,
    expiresAt,
  };
}
