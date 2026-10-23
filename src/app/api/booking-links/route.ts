import { NextResponse } from "next/server";
import { getAirportIndex } from "@/lib/airports-index";
import { createCallContext } from "@/lib/engine/calls";
import { checkHiddenMarket, type LowerPrice } from "@/lib/engine/hidden-market";
import { ignavProvider } from "@/lib/providers/ignav";
import { getStore, type Store } from "@/lib/store";
import type { BookingKey } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Market to check behind the scenes: the destination's country (or the origin's on the way home). */
async function hiddenMarketFor(store: Store, key: BookingKey, home: string): Promise<string | null> {
  try {
    const index = await getAirportIndex(store);
    const country = (code: string) => index.find((a) => a.code === code)?.country ?? null;
    const dest = country(key.dest);
    const market = dest && dest !== home ? dest : country(key.origin);
    return market && market !== home ? market : null;
  } catch {
    return null;
  }
}

// Fetched lazily, only when the user taps "Get booking links" (each call is billed).
// The UK-market links are returned as-is; another market is checked in parallel and,
// if it's cheaper, only a GBP price and quote id are returned — never its seller or link.
export async function POST(request: Request) {
  const { providerRef, adults, children, infants, bookingKey, priceGbp } = (await request.json().catch(() => ({}))) as {
    providerRef?: string;
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

  const ukLinks = ignavProvider.getBookingLinks(providerRef, filters, ctx, bookingKey);
  let lowerPrice: Promise<LowerPrice | null> = Promise.resolve(null);
  if (bookingKey) {
    lowerPrice = hiddenMarketFor(store, bookingKey, settings.market).then((market) =>
      market
        ? checkHiddenMarket({
            provider: ignavProvider,
            ctx,
            store,
            settings,
            key: bookingKey,
            filters,
            market,
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
