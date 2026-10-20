import { beforeEach, describe, expect, it } from "vitest";
import { runSearch } from "@/lib/engine/search";
import { buildOneWayRequest, normaliseOneWay, type IgnavFareSearchResponse } from "@/lib/providers/ignav";
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
