import { beforeEach, describe, expect, it } from "vitest";
import { runSearch } from "@/lib/engine/search";
import { buildOneWayRequest, normaliseOneWay, normaliseRoundTrip, type IgnavFareSearchResponse } from "@/lib/providers/ignav";
import type { FlightProvider } from "@/lib/providers/types";
import { createMemoryStore, type Store } from "@/lib/store";
import type { SearchRequest } from "@/lib/types";

// A fake Ignav that returns spec-shaped responses (see spec/ignav-openapi.json)
// and goes through the real request builder, cache and normaliser.
const DOMESTIC_HUBS = new Set(["DEL", "BOM", "CCU", "BLR"]);
let networkCalls = 0;

function segment(from: string, to: string, depUtc: string, mins: number, carrier: string, num: string) {
  const arr = new Date(Date.parse(depUtc) + mins * 60000).toISOString();
  return {
    marketing_carrier_code: carrier,
    flight_number: num,
    operating_carrier_name: carrier === "AI" ? "Air India" : carrier === "6E" ? "IndiGo" : "British Airways",
    departure_airport: from,
    departure_time_local: depUtc.slice(0, 19),
    departure_timezone: null,
    departure_time_utc: depUtc,
    arrival_airport: to,
    arrival_time_local: arr.slice(0, 19),
    arrival_timezone: null,
    arrival_time_utc: arr,
    duration_minutes: mins,
    aircraft: null,
  };
}

function fakeResponse(origin: string, dest: string, date: string): IgnavFareSearchResponse {
  const it = (ignav_id: string, amount: number, segs: ReturnType<typeof segment>[], checked: number | null) => ({
    ignav_id,
    price: { amount, currency: "GBP", status: "verified" as const },
    outbound: { carrier: segs[0].marketing_carrier_code, duration_minutes: null, segments: segs },
    bags: { checked, carry_on: 1 },
    requires_self_transfer: false,
  });
  const itineraries = [];
  if (origin.length === 3 && ["LHR", "MAN", "BHX", "LGW"].includes(origin)) {
    if (dest === "GAU") {
      itineraries.push(it(`${origin}-GAU-${date}`, 900, [segment(origin, "DEL", `${date}T20:00:00Z`, 540, "AI", "162"), segment("DEL", "GAU", `${addDay(date)}T08:00:00Z`, 150, "AI", "889")], 2));
    } else {
      itineraries.push(it(`${origin}-${dest}-${date}-a`, 450, [segment(origin, dest, `${date}T20:00:00Z`, 540, "AI", "162")], 2));
      itineraries.push(it(`${origin}-${dest}-${date}-b`, 380, [segment(origin, dest, `${date}T11:00:00Z`, 600, "BA", "143")], 0));
      itineraries.push(it(`${origin}-${dest}-${date}-c`, 2500, [segment(origin, dest, `${date}T12:00:00Z`, 560, "AI", "170")], 2));
    }
  } else if (origin === "GAU" && DOMESTIC_HUBS.has(dest)) {
    // Way home: GAU → hub.
    itineraries.push(it(`GAU-${dest}-${date}-1`, 60, [segment("GAU", dest, `${date}T03:00:00Z`, 150, "6E", "202")], 1));
    itineraries.push(it(`GAU-${dest}-${date}-2`, 75, [segment("GAU", dest, `${date}T08:00:00Z`, 150, "6E", "204")], 1));
  } else if (DOMESTIC_HUBS.has(origin)) {
    itineraries.push(it(`${origin}-GAU-${date}-1`, 70, [segment(origin, "GAU", `${date}T07:00:00Z`, 150, "6E", "201")], 1));
    itineraries.push(it(`${origin}-GAU-${date}-2`, 55, [segment(origin, "GAU", `${date}T12:00:00Z`, 150, "6E", "203")], 1));
  }
  return { origin, destination: dest, departure_date: date, return_date: null, itineraries, observed_at: "2026-10-20T08:00:00Z" };
}

function addDay(d: string) {
  return new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);
}

const fakeIgnav: FlightProvider = {
  id: "ignav",
  async searchOneWay(origin, dest, date, filters, ctx) {
    const body = buildOneWayRequest(origin, dest, date, filters, ctx.settings);
    const res = await ctx.call({
      provider: "ignav",
      endpoint: "/api/fares/one-way",
      body,
      label: `${origin}→${dest} ${date}`,
      fetcher: async () => {
        networkCalls++;
        return fakeResponse(origin, dest, date);
      },
    });
    return normaliseOneWay(res.raw as IgnavFareSearchResponse, { ...res, passengers: filters.adults + filters.children }, ctx.settings).itineraries;
  },
  async searchRoundTrip(origin, dest, date, returnDate, filters, ctx) {
    const body = { ...buildOneWayRequest(origin, dest, date, filters, ctx.settings), return_date: returnDate };
    const res = await ctx.call({
      provider: "ignav",
      endpoint: "/api/fares/round-trip",
      body,
      label: `${origin}⇄${dest}`,
      fetcher: async () => {
        networkCalls++;
        // Pair each outbound with a mirrored inbound leaving `dest` at 13:00Z on the return date.
        const outbound = fakeResponse(origin, dest, date);
        return {
          ...outbound,
          return_date: returnDate,
          itineraries: outbound.itineraries.map((i) => {
            const back = [...i.outbound.segments].reverse().map((s, k) =>
              segment(s.arrival_airport, s.departure_airport, `${returnDate}T${String(13 + k * 6).padStart(2, "0")}:00:00Z`, s.duration_minutes, s.marketing_carrier_code!, `${s.flight_number}R`),
            );
            return { ...i, price: { ...i.price, amount: Math.round(i.price.amount * 1.6) }, inbound: { carrier: back[0].marketing_carrier_code, duration_minutes: null, segments: back } };
          }),
        };
      },
    });
    return normaliseRoundTrip(res.raw as IgnavFareSearchResponse, { ...res, passengers: filters.adults + filters.children }, ctx.settings).trips;
  },
  async getBookingLinks() {
    return [];
  },
};

const req: SearchRequest = { originArea: "Stafford", dest: "GAU", date: "2026-12-10", flexDays: 0, adults: 2, children: 0, bags: 1, bagKg: 23 };

describe("runSearch (fake Ignav)", () => {
  let store: Store;
  beforeEach(() => {
    store = createMemoryStore();
    networkCalls = 0;
  });

  it("stays under 60 provider calls for a ±0 day search and finds both strategies", async () => {
    const res = await runSearch(req, { store, provider: fakeIgnav });
    expect(res.errors).toEqual([]);
    expect(res.stats.paidCalls).toBe(networkCalls);
    expect(res.stats.paidCalls).toBeLessThan(60);
    // 4 through + 32 international (4 UK × 8 hubs) + 16 domestic (8 hubs × 2 dates) = 52.
    expect(res.stats.paidCalls).toBe(52);
    expect(res.options.some((o) => o.kind === "through")).toBe(true);
    const split = res.options.filter((o) => o.kind === "split");
    expect(split.length).toBeGreaterThan(0);
    for (const o of split) {
      expect(o.connection!.bufferMins).toBeGreaterThanOrEqual(o.connection!.minRequiredMins);
      expect(o.badges).toContain("Separate tickets");
    }
    // £2500 fares are > 1.5 × £900 cheapest through ticket and must be pruned.
    expect(res.options.every((o) => o.costs.fares[0] < 1350)).toBe(true);
    // 23kg bags on a 15kg domestic allowance.
    expect(split.every((o) => o.badges.includes("Excess baggage risk"))).toBe(true);
  });

  it("serves a repeat search entirely from cache and learns which hubs have no service", async () => {
    await runSearch(req, { store, provider: fakeIgnav });
    const first = networkCalls;
    const again = await runSearch(req, { store, provider: fakeIgnav });
    expect(networkCalls).toBe(first);
    expect(again.stats.paidCalls).toBe(0);
    expect(again.stats.cacheHits).toBeGreaterThan(0);
    // Hubs with no domestic flights to GAU were recorded and are skipped next time.
    const cfg = await store.loadConfig();
    expect(cfg.hubRoutes.filter((h) => !h.has_service).map((h) => h.hub).sort()).toEqual(["AMD", "COK", "HYD", "MAA"]);
    expect(again.notes.join(" ")).toContain("Not searching");
  });

  it("searches the user's airports, keeping results that depart from any London airport", async () => {
    // The fake answers for whatever origin is asked; a "LON" search returns flights that
    // actually leave from LHR, which must not be dropped for lacking a ground entry.
    const lonAsLhr: FlightProvider = {
      ...fakeIgnav,
      searchOneWay: async (o, d, date, f, ctx) =>
        (await fakeIgnav.searchOneWay(o === "LON" ? "LHR" : o, d, date, f, ctx)),
    };
    const res = await runSearch({ ...req, originArea: "Leeds", ukAirports: ["LON"], infants: 1 }, { store, provider: lonAsLhr });
    expect(res.errors).toEqual([]);
    expect(res.options.length).toBeGreaterThan(0);
    expect(new Set(res.options.map((o) => o.ukAirport))).toEqual(new Set(["LHR"]));
    expect(res.options.every((o) => o.ground.mode === "not set")).toBe(true); // no Leeds prices configured
    expect(res.stats.paidCalls).toBeLessThanOrEqual(1 + 8 + 16); // one origin: 1 through + 8 international + domestic
  });

  it("rejects bad passenger and airport input", async () => {
    const { validateRequest } = await import("@/lib/engine/search");
    expect(validateRequest({ ...req, infants: 3, adults: 2 })).toMatch(/infant/);
    expect(validateRequest({ ...req, dest: "Guwahati" })).toMatch(/destination/);
    expect(validateRequest({ ...req, ukAirports: [] })).toMatch(/UK airports/);
    expect(validateRequest({ ...req, ukAirports: ["BHX", "MAN", "LON"], infants: 1 })).toBeNull();
  });

  it("reports a clear error when every call fails", async () => {
    const broken: FlightProvider = { ...fakeIgnav, searchOneWay: async () => { throw new Error("IGNAV_API_KEY is not set on the server"); } };
    const res = await runSearch(req, { store, provider: broken });
    expect(res.options).toEqual([]);
    expect(res.errors).toEqual(["IGNAV_API_KEY is not set on the server (36 searches)"]);
  });
});

describe("Ignav self-transfer itineraries", () => {
  it("splits where the trip enters India so our connection rules apply", async () => {
    const { splitAtIndiaEntry } = await import("@/lib/engine/search");
    const seg = (o: string, d: string, dep: string, arr: string, oTz: string, dTz: string, c: string) => ({
      carrier: c, carrierName: null, flightNumber: "1", origin: o, dest: d, departUtc: dep, arriveUtc: arr, departTz: oTz, arriveTz: dTz, durationMins: 0, aircraft: null,
    });
    const it = {
      provider: "ignav" as const, providerRef: "x", origin: "LHR", dest: "GAU", departUtc: "2026-12-10T08:35:00Z", arriveUtc: "2026-12-11T03:30:00Z", durationMins: 0,
      carrier: "QR", carrierName: "Qatar", price: { amount: 1943, currency: "GBP", totalGbp: 1943, verified: true, fxApprox: false },
      baggage: { checkedPieces: 1, carryOnPieces: 1 }, selfTransfer: true, observedAt: null, fetchedAt: "x", fromCache: false,
      segments: [
        seg("LHR", "DOH", "2026-12-10T08:35:00Z", "2026-12-10T15:00:00Z", "Europe/London", "Asia/Qatar", "QR"),
        seg("DOH", "DEL", "2026-12-10T17:10:00Z", "2026-12-10T21:00:00Z", "Asia/Qatar", "Asia/Kolkata", "QR"),
        seg("DEL", "GAU", "2026-12-11T01:10:00Z", "2026-12-11T03:30:00Z", "Asia/Kolkata", "Asia/Kolkata", "AI"),
      ],
    };
    const parts = splitAtIndiaEntry(it, () => null)!;
    expect(parts[0].segments.map((s) => s.dest)).toEqual(["DOH", "DEL"]);
    expect(parts[0].price.totalGbp).toBe(1943);
    expect(parts[1].origin).toBe("DEL");
    expect(parts[1].carrier).toBe("AI");
    expect(parts[1].price.totalGbp).toBe(0); // included in the first part
    expect(parts[1].baggage.checkedPieces).toBeNull(); // domestic defaults apply
    // Never enters India mid-trip → can't place the ticket change.
    expect(splitAtIndiaEntry({ ...it, segments: [it.segments[0]] }, () => null)).toBeNull();
  });
});

describe("self-transfer buffers", () => {
  it("requires the minimum buffer at every change of airline", async () => {
    const { airlineChangesHaveBuffer } = await import("@/lib/engine/search");
    const seg = (c: string, dep: string, arr: string) => ({ carrier: c, carrierName: null, flightNumber: "1", origin: "A", dest: "B", departUtc: dep, arriveUtc: arr, departTz: null, arriveTz: null, durationMins: 0, aircraft: null });
    const base = { segments: [
      seg("U2", "2026-12-10T06:00:00Z", "2026-12-10T09:00:00Z"),
      seg("SV", "2026-12-10T11:00:00Z", "2026-12-10T16:00:00Z"), // 2h after easyJet lands
      seg("SV", "2026-12-10T17:00:00Z", "2026-12-10T21:00:00Z"), // same airline: 1h is fine
    ] } as never;
    expect(airlineChangesHaveBuffer(base, 180)).toBe(false);
    expect(airlineChangesHaveBuffer(base, 120)).toBe(true);
  });
});

describe("return trips", () => {
  const rt: SearchRequest = { ...req, returnDate: "2027-01-05" };

  it("uses return fares and adds the domestic flight home", async () => {
    networkCalls = 0;
    const store = createMemoryStore();
    const res = await runSearch(rt, { store, provider: fakeIgnav });
    expect(res.errors).toEqual([]);
    // 4 through + 32 international (return fares) + 16 domestic out + 8 domestic home (GAU → each hub).
    expect(res.stats.paidCalls).toBe(4 + 32 + 16 + 8);
    expect(res.options.length).toBeGreaterThan(0);
    for (const o of res.options) {
      expect(o.back).not.toBeNull();
      expect(o.totalMins).toBe(o.outMins + o.back!.totalMins);
    }
    const split = res.options.filter((o) => o.kind === "split");
    expect(split.length).toBeGreaterThan(0);
    for (const o of split) {
      const [homeDom, homeIntl] = o.back!.legs;
      expect(homeDom.itinerary.origin).toBe("GAU");
      expect(homeIntl.bundled).toBe(true); // priced on the outbound return fare
      expect(homeIntl.itinerary.price.totalGbp).toBe(0);
      expect(o.back!.connection!.bufferMins).toBeGreaterThanOrEqual(o.back!.connection!.minRequiredMins);
      // Ground travel counted both ways (Stafford train £15–£45 per person, 2 people).
      expect(o.costs.ground).toBe(o.ground.cost_gbp * 2 * 2);
    }
    const through = res.options.find((o) => o.kind === "through")!;
    expect(through.back!.legs).toHaveLength(1);
    expect(through.back!.legs[0].itinerary.segments.map((s) => s.dest)).toEqual(["DEL", through.ukAirport]);
  });

  it("rejects a return before departure", async () => {
    const { validateRequest } = await import("@/lib/engine/search");
    expect(validateRequest({ ...rt, returnDate: "2026-12-10" })).toMatch(/after the departure/);
    expect(validateRequest({ ...rt, returnDate: "2026-12-11", flexDays: 1 })).toMatch(/after the departure/);
    expect(validateRequest(rt)).toBeNull();
  });
});
