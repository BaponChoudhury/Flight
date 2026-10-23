import { describe, expect, it } from "vitest";
import { defaultConfig } from "@/lib/config/defaults";
import { createCallContext } from "@/lib/engine/calls";
import { checkHiddenMarket } from "@/lib/engine/hidden-market";
import { getGbpRates, toGbpWithMargin, type GbpRates } from "@/lib/fx";
import type { FlightProvider } from "@/lib/providers/types";
import { createMemoryStore } from "@/lib/store";
import type { BookingLink } from "@/lib/types";

const FX: GbpRates = { rates: { GBP: 1, INR: 126.5, AED: 4.89 }, fetchedAt: new Date().toISOString(), source: "test" };
const link = (provider: string, amount: number, currency: string, fareName: string | null = null): BookingLink => ({
  providerName: provider,
  providerType: "third_party",
  exactFlight: true,
  fareName,
  price: { amount, currency },
  url: `https://${provider.toLowerCase()}.example/book`,
});
const key = { origin: "LHR", dest: "DEL", date: "2026-12-10", carrier: "MS", flightNumber: "784" };
const filters = { adults: 1, children: 0, infants: 0, allowSelfTransfer: false };

function provider(foreign: BookingLink[]): FlightProvider & { markets: string[] } {
  const markets: string[] = [];
  return {
    id: "ignav",
    markets,
    searchOneWay: async () => [],
    searchRoundTrip: async () => [],
    getBookingLinks: async () => [],
    getMarketBookingLinks: async (_k, _f, _c, market) => {
      markets.push(market);
      return foreign;
    },
  };
}

describe("FX margin", () => {
  it("takes 0.4% off the mid rate, rounding the £ price up", () => {
    // 77,400 / (126.5 × 0.996) = 614.3149… → rounded up to £614.32
    expect(toGbpWithMargin(77400, "INR", FX, 0.4)).toBe(614.32);
    expect(toGbpWithMargin(77400, "INR", FX, 0)).toBe(611.86);
    expect(toGbpWithMargin(500, "GBP", FX, 0.4)).toBe(500);
    expect(toGbpWithMargin(10, "XYZ", FX, 0.4)).toBeNull();
  });

  it("caches live rates and returns null (no stale fallback) when they can't be fetched", async () => {
    const store = createMemoryStore();
    let calls = 0;
    const ok = async () => {
      calls++;
      return FX;
    };
    expect(await getGbpRates(store, ok)).toEqual(FX);
    expect(await getGbpRates(store, ok)).toEqual(FX);
    expect(calls).toBe(1);
    const empty = createMemoryStore();
    expect(await getGbpRates(empty, async () => { throw new Error("down"); })).toBeNull();
  });
});

describe("hidden market check", () => {
  const settings = defaultConfig().settings;

  async function run(foreign: BookingLink[], ukLinks: BookingLink[], opts: { fx?: GbpRates | null; ukSearch?: number | null } = {}) {
    const store = createMemoryStore();
    const p = provider(foreign);
    const result = await checkHiddenMarket({
      provider: p,
      ctx: createCallContext(store, settings),
      store,
      settings,
      key,
      filters,
      market: "IN",
      ukLinks,
      ukSearchPriceGbp: opts.ukSearch ?? null,
      fetchFx: async () => {
        if (opts.fx === null) throw new Error("fx down");
        return opts.fx ?? FX;
      },
    });
    return { result, store, p };
  }

  it("offers the cheapest foreign seller as a GBP price and keeps the details server-side", async () => {
    const { result, store, p } = await run(
      [link("FlightHub", 77400, "INR", "Economy Saver"), link("Gotogate", 81439, "INR")],
      [link("Omio", 723, "GBP")],
    );
    expect(p.markets).toEqual(["IN"]);
    expect(result).toMatchObject({ priceGbp: 614.32, ukPriceGbp: 723, savingGbp: 108.68, fareName: "Economy Saver" });
    // Nothing identifying the market or seller goes back to the customer.
    expect(JSON.stringify(result)).not.toMatch(/FlightHub|INR|IN"|example/);
    const quote = await store.getQuote(result!.quoteId);
    expect(quote).toMatchObject({ market: "IN", provider_name: "FlightHub", local_amount: 77400, local_currency: "INR", price_gbp: 614.32 });
    expect(quote!.applied_rate).toBeCloseTo(125.994, 3);
  });

  it("doesn't offer a saving smaller than the minimum", async () => {
    // 90,600 INR ≈ £719.08 vs UK £723: saving under £5.
    const { result } = await run([link("FlightHub", 90600, "INR")], [link("Omio", 723, "GBP")]);
    expect(result).toBeNull();
  });

  it("falls back to the UK search price when UK links carry no price", async () => {
    const { result } = await run([link("FlightHub", 77400, "INR")], [{ ...link("Airline", 0, "GBP"), price: null }], { ukSearch: 700 });
    expect(result).toMatchObject({ ukPriceGbp: 700, savingGbp: 85.68 });
  });

  it("offers nothing without live FX rates", async () => {
    const { result, p } = await run([link("FlightHub", 77400, "INR")], [link("Omio", 723, "GBP")], { fx: null });
    expect(result).toBeNull();
    expect(p.markets).toEqual([]); // and doesn't spend an Ignav call
  });
});
