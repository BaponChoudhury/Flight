import { NextResponse } from "next/server";
import { getAirportIndex } from "@/lib/airports-index";
import { createCallContext } from "@/lib/engine/calls";
import { checkHiddenMarket, type LowerPrice } from "@/lib/engine/hidden-market";
import { createAviasalesProvider, parseRef } from "@/lib/providers/aviasales";
import { ignavProvider } from "@/lib/providers/ignav";
import { clientOf } from "@/lib/client";
import { getAirlineCountries } from "@/lib/airlines-index";
import { getStore, type Store } from "@/lib/store";
import type { BookingKey, Settings } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Markets to check behind the scenes: the destination's country (the origin's on the way
 * home) and the home country of each airline on the trip, e.g. Bahrain for Gulf Air.
 */
async function hiddenMarketsFor(store: Store, key: BookingKey, settings: Settings): Promise<string[]> {
  const home = settings.market;
  const markets: string[] = [];
  try {
    const index = await getAirportIndex(store);
    const country = (code: string) => index.find((a) => a.code === code)?.country ?? null;
    const dest = country(key.dest);
    const place = dest && dest !== home ? dest : country(key.origin);
    if (place) markets.push(place);
  } catch {
    /* airport list unavailable: airline markets only */
  }
  const carriers = [...new Set((key.flights ?? [key.carrier ?? ""]).map((f) => f.slice(0, 2)).filter(Boolean))];
  if (carriers.length) {
    const airlineCountry = { ...(await getAirlineCountries(store)), ...settings.airline_country_overrides };
    for (const c of carriers) if (airlineCountry[c]) markets.push(airlineCountry[c]);
  }
  return [...new Set(markets.filter((m) => m !== home))].slice(0, settings.hidden_markets_max);
}

// Fetched lazily, only when the user taps "Get booking links" (each call is billed).
// The UK-market links are returned as-is; another market is checked in parallel and,
// if it's cheaper, only a GBP price and quote id are returned — never its seller or link.
export async function POST(request: Request) {
  const { providerRef, adults, children, infants, bookingKey, priceGbp, refundable } = (await request.json().catch(() => ({}))) as {
    providerRef?: string;
    refundable?: boolean;
    adults?: number;
    children?: number;
    infants?: number;
    bookingKey?: BookingKey;
    priceGbp?: number;
  };
  if (!providerRef || !adults) return NextResponse.json({ error: "Missing itinerary." }, { status: 400 });
  const store = getStore();
  const { settings } = await store.loadConfig();
  const ctx = createCallContext(store, settings);
  const filters = { adults, children: children ?? 0, infants: infants ?? 0, allowSelfTransfer: false };

  // Aviasales fares carry their own link token; the lower-price check still looks the flights up on Ignav.
  const provider = parseRef(providerRef) ? createAviasalesProvider(clientOf(request)) : ignavProvider;
  const ukLinks = provider.getBookingLinks(providerRef, filters, ctx, bookingKey);
  let lowerPrice: Promise<LowerPrice | null> = Promise.resolve(null);
  // A refundable fare isn't matched by "same flights, lower price": the cheaper fare may not be refundable.
  if (bookingKey && !refundable) {
    lowerPrice = hiddenMarketsFor(store, bookingKey, settings).then((markets) =>
      markets.length
        ? checkHiddenMarket({
            provider: ignavProvider,
            ctx,
            store,
            settings,
            key: bookingKey,
            filters,
            markets,
            ukLinks,
            ukSearchPriceGbp: typeof priceGbp === "number" && Number.isFinite(priceGbp) && priceGbp > 0 ? priceGbp : null,
          }).catch((err) => {
            console.warn(`hidden market check failed: ${(err as Error).message}`);
            return null;
          })
        : null,
    );
  }

  try {
    const [links, lower] = await Promise.all([ukLinks, lowerPrice]);
    return NextResponse.json({ links, lowerPrice: lower });
  } catch (err) {
    const lower = await lowerPrice;
    if (lower) return NextResponse.json({ links: [], lowerPrice: lower });
    return NextResponse.json({ error: `Couldn't get booking links: ${(err as Error).message}` }, { status: 502 });
  }
}
