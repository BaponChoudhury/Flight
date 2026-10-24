import { describe, expect, it } from "vitest";
import { refundableView } from "@/lib/engine/rules";
import { runSearch } from "@/lib/engine/search";
import { bagPieces, fareTermsOf, looksSelfTransfer, normaliseSearch, parseRef, signatureString, type AviasalesSearch } from "@/lib/providers/aviasales";
import type { FlightProvider, SearchFilters } from "@/lib/providers/types";
import { createMemoryStore } from "@/lib/store";
import type { SearchRequest } from "@/lib/types";

// Rates are RUB per unit, as in the start response: £1 = 100 RUB here.
const RATES = { gbp: 100, eur: 90, rub: 1 };
const t = (iso: string) => Date.parse(iso) / 1000;
const flight = (from: string, to: string, dep: string, mins: number, carrier: string, number: string) => ({
  departure: from,
  arrival: to,
  departure_timestamp: t(dep),
  arrival_timestamp: t(dep) + mins * 60,
  duration: mins,
  marketing_carrier: carrier,
  number,
});
const info = (refund: boolean | undefined, change: boolean | undefined, penaltyRub?: number) => ({
  return_before_flight: refund === undefined ? undefined : { available: refund, ...(penaltyRub ? { penalty: { currency_code: "rub", value: penaltyRub } } : {}) },
  change_before_flight: change === undefined ? undefined : { available: change },
});
const term = (rub: number, url: number, opts: { bags?: (string | false)[]; refund?: boolean; change?: boolean; penalty?: number; virtual?: boolean } = {}) => {
  const n = opts.bags?.length ?? 1;
  return {
    currency: "gbp",
    price: rub / 100,
    unified_price: rub,
    url,
    flights_baggage: [opts.bags ?? ["1PC23"]],
    flights_handbags: [Array(n).fill("1PC")],
    flight_additional_tariff_infos: [Array.from({ length: n }, () => info(opts.refund, opts.change, opts.penalty))],
    transfer_terms: [Array.from({ length: Math.max(n - 1, 0) }, () => ({ is_virtual_interline: !!opts.virtual }))],
  };
};

const SEARCH: AviasalesSearch = {
  searchId: "sid-1",
  rates: RATES,
  airports: { LHR: { tz: "Europe/London" }, LGW: { tz: "Europe/London" }, DEL: { tz: "Asia/Kolkata" }, GAU: { tz: "Asia/Kolkata" } },
  gates: { "1": "CheapTrips", "2": "Air India" },
  complete: true,
  proposals: [
    // Air India via Delhi: a cheap non-refundable seller and a dearer refundable one.
    {
      segment: [{ flight: [flight("LHR", "DEL", "2026-12-10T20:00:00Z", 540, "AI", "162"), flight("DEL", "GAU", "2026-12-11T08:00:00Z", 150, "AI", "889")] }],
      terms: {
        "1": term(60_000, 101, { bags: ["1PC23", "1PC23"], refund: false, change: true }),
        "2": term(85_000, 201, { bags: ["2PC23", "2PC23"], refund: true, change: true, penalty: 12_000 }),
      },
    },
    // A budget combo sold as separate tickets (virtual interline), no checked bags.
    {
      segment: [{ flight: [flight("LGW", "DEL", "2026-12-10T10:00:00Z", 560, "XY", "1"), flight("DEL", "GAU", "2026-12-11T06:00:00Z", 150, "6E", "201")] }],
      terms: { "1": term(40_000, 102, { bags: [false, false], refund: false, virtual: true }) },
    },
  ],
};

const filters = (f: Partial<SearchFilters> = {}): SearchFilters => ({ adults: 2, children: 0, allowSelfTransfer: true, ...f });
const norm = (f: Partial<SearchFilters> = {}, origin = "LON") =>
  normaliseSearch(SEARCH, { filters: filters(f), origin, fetchedAt: "2026-10-23T10:00:00Z", fromCache: false }).map((x) => x.out);

describe("Aviasales signing", () => {
  it("joins the token and values sorted by key, as in the Travelpayouts example", () => {
    const body = {
      currency_code: "USD",
      marker: "YourMarker",
      market_code: "US",
      locale: "US",
      search_params: {
        directions: [
          { origin: "LAX", destination: "NYC", date: "2026-09-09" },
          { origin: "NYC", destination: "LAX", date: "2026-09-25" },
        ],
        trip_class: "Y",
        passengers: { adults: 1, children: 0, infants: 0 },
      },
    };
    expect(signatureString("YourToken", body)).toBe("YourToken:USD:US:YourMarker:US:2026-09-09:NYC:LAX:2026-09-25:LAX:NYC:1:0:0:Y");
  });
});

describe("Aviasales normalising", () => {
  it("reads bag codes", () => {
    expect([bagPieces("1PC23"), bagPieces("2PC"), bagPieces("0PC"), bagPieces(false), bagPieces(""), bagPieces("20")]).toEqual([1, 2, 0, 0, null, null]);
  });

  it("treats mixed airlines without a shared alliance as separate tickets", () => {
    const f = (c: string) => ({ marketing_carrier: c });
    const alliances = { AF: "SkyTeam", KL: "SkyTeam", BA: "oneworld", FR: null };
    expect(looksSelfTransfer([f("AF"), f("KL")], alliances)).toBe(false);
    expect(looksSelfTransfer([f("AI"), f("AI")], alliances)).toBe(false);
    expect(looksSelfTransfer([f("FR"), f("J2")], alliances)).toBe(true);
    expect(looksSelfTransfer([f("BA"), f("AF")], alliances)).toBe(true);
  });

  it("only calls a fare refundable when every flight says so, and converts the fee", () => {
    expect(fareTermsOf(term(1, 1, { bags: ["1PC", "1PC"], refund: true, change: false, penalty: 5_000 }), RATES)).toEqual({ refundable: true, refundFeeGbp: 50, changeable: false });
    const mixed = { ...term(1, 1, { bags: ["1PC", "1PC"] }), flight_additional_tariff_infos: [[info(true, true), null]] };
    expect(fareTermsOf(mixed, RATES).refundable).toBeNull();
  });

  it("prices each trip at its cheapest seller, in GBP for the whole party, with times in UTC", () => {
    const [ai, , combo] = norm();
    expect(ai.price.totalGbp).toBe(600);
    expect(ai.seller).toBe("CheapTrips");
    expect(ai.fareTerms).toEqual({ refundable: false, refundFeeGbp: null, changeable: true });
    expect(ai.segments[0].departUtc).toBe("2026-12-10T20:00:00.000Z");
    expect(ai.bookingKey?.flights).toEqual(["AI162", "AI889"]);
    expect(parseRef(ai.providerRef)).toEqual({ searchId: "sid-1", url: "101", seller: "CheapTrips" });
    expect(combo.selfTransfer).toBe(true);
    expect(combo.baggage.checkedPieces).toBe(0);
  });

  it("also keeps the cheapest refundable fare when the cheapest isn't, for the results filter", () => {
    const [ai, aiRefundable] = norm();
    expect(ai.fareTerms?.refundable).toBe(false);
    expect(aiRefundable).toMatchObject({ seller: "Air India", fareTerms: { refundable: true } });
    expect(aiRefundable.price.totalGbp).toBe(850);
    expect(aiRefundable.segments.map((x) => x.flightNumber)).toEqual(["162", "889"]);
  });

  it("refundable only: picks the refundable seller and drops non-refundable fares", () => {
    const out = norm({ refundableOnly: true });
    expect(out).toHaveLength(1);
    expect(out[0].price.totalGbp).toBe(850);
    expect(out[0].seller).toBe("Air India");
    expect(out[0].fareTerms?.refundFeeGbp).toBe(120);
  });

  it("drops fares known to lack the bags, self-transfer combos when not allowed, and other airports", () => {
    expect(norm({ minCheckedBags: 2 }).map((i) => i.price.totalGbp)).toEqual([850]);
    expect(norm({ allowSelfTransfer: false }).map((i) => i.price.totalGbp)).toEqual([600, 850]); // Air India, cheapest and refundable
    expect(norm({}, "LGW").map((i) => i.origin)).toEqual(["LGW"]);
    expect(norm({ maxStops: 0 })).toHaveLength(0);
  });
});

describe("runSearch with Aviasales alongside Ignav", () => {
  const req: SearchRequest = { originArea: "", ukAirports: ["LON"], dest: "GAU", date: "2026-12-10", flexDays: 0, adults: 2, children: 0, bags: 1 };
  const makeIgnav = () => {
    const calls: string[] = [];
    const p: FlightProvider = {
      id: "ignav",
      async searchOneWay(o, d, date) {
        calls.push(`${o}-${d}-${date}`);
        return [];
      },
      async searchRoundTrip() {
        return [];
      },
      async getBookingLinks() {
        return [];
      },
      async getMarketBookingLinks() {
        return [];
      },
    };
    return { p, calls };
  };
  const fakeAviasales: FlightProvider = {
    id: "aviasales",
    async searchOneWay(origin, _d, _date, f, ctx) {
      const res = await ctx.call({ provider: "aviasales", endpoint: "/v1/flight_search", body: { origin, f }, label: "as", ttlMins: 10, fetcher: async () => SEARCH });
      return normaliseSearch(res.raw as AviasalesSearch, { filters: f, origin, fetchedAt: res.fetchedAt, fromCache: res.fromCache }).map((x) => x.out);
    },
    async searchRoundTrip() {
      return [];
    },
    async getBookingLinks() {
      return [];
    },
    async getMarketBookingLinks() {
      return [];
    },
  };

  it("adds Aviasales through tickets, with fare rules and the Refundable badge", async () => {
    const ignav = makeIgnav();
    const res = await runSearch(req, { store: createMemoryStore(), provider: ignav.p, throughProviders: [fakeAviasales] });
    expect(ignav.calls.length).toBeGreaterThan(0);
    expect(res.stats.paidByProvider).toEqual({ ignav: 0, aviasales: 1 });
    const through = res.options.find((o) => o.kind === "through")!;
    expect(through.legs[0].itinerary.provider).toBe("aviasales");
    expect(through.badges).not.toContain("Refundable");
  });

  it("shows the same flights from both sources once, at the cheaper price", async () => {
    // Ignav has Aviasales' £600 Air India trip at £700, with AI889's time 5 minutes off.
    const [avia] = norm({ minCheckedBags: 1 });
    const segments = avia.segments.map((sg, i) => (i === 1 ? { ...sg, departUtc: "2026-12-11T08:05:00.000Z" } : sg));
    const fromIgnav = { ...avia, provider: "ignav" as const, seller: null, segments, price: { ...avia.price, amount: 700, totalGbp: 700 } };
    const ignav = makeIgnav();
    const p: FlightProvider = { ...ignav.p, searchOneWay: async (o, d, date, f, ctx) => (d === "GAU" && o === "LON" ? [fromIgnav] : ignav.p.searchOneWay(o, d, date, f, ctx)) };
    const res = await runSearch(req, { store: createMemoryStore(), provider: p, throughProviders: [fakeAviasales] });
    const airIndia = res.options.filter((o) => o.legs[0].itinerary.segments[0].flightNumber === "162");
    expect(airIndia).toHaveLength(1);
    expect(airIndia[0].legs[0].itinerary.provider).toBe("aviasales");
    expect(airIndia[0].costs.fares[0]).toBe(600);
    expect(airIndia[0].otherPrices).toEqual([{ provider: "ignav", seller: null, totalGbp: 700 }]);
  });

  it("keeps the refundable fare on each option so the results page can filter without a new search", async () => {
    const res = await runSearch(req, { store: createMemoryStore(), provider: makeIgnav().p, throughProviders: [fakeAviasales] });
    const airIndia = res.options.filter((o) => o.legs[0].itinerary.segments[0].flightNumber === "162");
    expect(airIndia).toHaveLength(1);
    expect(airIndia[0].costs.fares[0]).toBe(600);
    expect(airIndia[0].badges).not.toContain("Refundable");
    expect(airIndia[0].refundableVersion?.costs.fares[0]).toBe(850);
    expect(airIndia[0].refundableVersion?.badges).toContain("Refundable");
    expect(res.options.flatMap((o) => refundableView(o) ?? []).map((o) => o.costs.fares[0])).toEqual([850]);
  });

  it("refundable only: skips Ignav and returns only refundable fares", async () => {
    const ignav = makeIgnav();
    const res = await runSearch({ ...req, refundableOnly: true }, { store: createMemoryStore(), provider: ignav.p, throughProviders: [fakeAviasales] });
    expect(ignav.calls).toEqual([]);
    expect(res.options).toHaveLength(1);
    expect(res.options[0].badges).toContain("Refundable");
    expect(res.options[0].costs.fares[0]).toBe(850);
  });

  it("refundable only without Aviasales says so instead of searching", async () => {
    const ignav = makeIgnav();
    const res = await runSearch({ ...req, refundableOnly: true }, { store: createMemoryStore(), provider: ignav.p });
    expect(ignav.calls).toEqual([]);
    expect(res.errors.join(" ")).toMatch(/Aviasales isn't set up/);
  });
});
