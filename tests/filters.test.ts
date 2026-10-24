import { describe, expect, it } from "vitest";
import { activeCount, applyFilters, facetsOf, NO_FILTERS, stopsOf, viaOf } from "@/lib/filters";
import type { Badge, NormalisedItinerary, RouteOption } from "@/lib/types";
import { itin } from "./helpers";

const TZ = { MAN: "Europe/London", LHR: "Europe/London", DEL: "Asia/Kolkata", BLR: "Asia/Kolkata", AUH: "Asia/Dubai", GAU: "Asia/Kolkata" };

// A trip made of flights [from, to, carrier, departUtc, hours], each its own leg.
function opt(flights: [string, string, string, string, number][], p: { total: number; badges?: Badge[]; ukAirport?: string; bagsUnknown?: boolean }): RouteOption {
  const legs = flights.map(([from, to, carrier, dep, h]) => {
    const it: NormalisedItinerary = itin({ origin: from, dest: to, departUtc: dep, arriveUtc: new Date(Date.parse(dep) + h * 3600000).toISOString(), gbp: 1, carrier });
    return { routeType: "international" as const, itinerary: it, bag: {} as never };
  });
  const start = legs[0].itinerary.departUtc;
  const end = legs[legs.length - 1].itinerary.arriveUtc;
  const mins = (Date.parse(end) - Date.parse(start)) / 60000;
  return {
    id: String(Math.random()),
    kind: legs.length > 1 ? "split" : "through",
    ukAirport: p.ukAirport ?? flights[0][0],
    hub: null,
    dest: "GAU",
    legs,
    back: null,
    badges: p.badges ?? [],
    costs: { total: p.total, bagsUnknown: !!p.bagsUnknown } as never,
    totalMins: mins,
    outMins: mins,
  } as unknown as RouteOption;
}

// MAN 13:50 → AUH → BLR (Etihad), then BLR → GAU (IndiGo) on a separate ticket: £391.
const cheap = opt(
  [
    ["MAN", "AUH", "EY", "2026-12-10T13:50:00Z", 7],
    ["AUH", "BLR", "EY", "2026-12-10T21:30:00Z", 4],
    ["BLR", "GAU", "6E", "2026-12-11T10:15:00Z", 3],
  ],
  { total: 391, badges: ["Separate tickets", "Excess baggage risk"] },
);
// LHR 20:00 → DEL → GAU on one Air India ticket: £950.
const protectedTrip = opt(
  [
    ["LHR", "DEL", "AI", "2026-12-10T20:00:00Z", 9],
    ["DEL", "GAU", "AI", "2026-12-11T08:00:00Z", 2.5],
  ],
  { total: 950, badges: ["Refundable"] },
);
// MAN 06:00 → DEL (Air India), then DEL → GAU: £560, terminal change, bag price unknown.
const morning = opt(
  [
    ["MAN", "DEL", "AI", "2026-12-10T06:00:00Z", 9],
    ["DEL", "GAU", "6E", "2026-12-11T02:00:00Z", 2.5],
  ],
  { total: 560, badges: ["Separate tickets", "Terminal change"], bagsUnknown: true },
);
const all = [cheap, protectedTrip, morning];
const show = (f: Partial<typeof NO_FILTERS>) => applyFilters(all, { ...NO_FILTERS, ...f }, TZ).map((o) => o.costs.total);

describe("results filters", () => {
  it("shows everything with no filters", () => {
    expect(show({})).toEqual([391, 950, 560]);
    expect(activeCount(NO_FILTERS)).toBe(0);
    expect(activeCount({ ...NO_FILTERS, maxStops: 1, hiddenAirlines: ["EY"] })).toBe(2);
  });

  it("filters by ticket type, stops, price and journey time", () => {
    expect(show({ ticketTypes: ["one"] })).toEqual([950]);
    expect(show({ ticketTypes: ["separate"] })).toEqual([391, 560]);
    expect(stopsOf(cheap)).toBe(2);
    expect(show({ maxStops: 1 })).toEqual([950, 560]);
    expect(show({ maxPrice: 600 })).toEqual([391, 560]);
    expect(show({ maxMins: 16 * 60 })).toEqual([950]);
  });

  it("filters by local departure and arrival time", () => {
    // UK departures: 13:50 afternoon, 20:00 evening, 06:00 morning.
    expect(show({ departTimes: ["morning"] })).toEqual([560]);
    expect(show({ departTimes: ["afternoon", "evening"] })).toEqual([391, 950]);
    // Arrivals at GAU (IST): 18:45 evening, 14:00 afternoon, 10:00 morning.
    expect(show({ arriveTimes: ["morning", "afternoon"] })).toEqual([950, 560]);
  });

  it("hides trips that use an unticked UK airport, airline or connecting airport", () => {
    expect(show({ hiddenUkAirports: ["LHR"] })).toEqual([391, 560]);
    expect(show({ hiddenAirlines: ["6E"] })).toEqual([950]);
    expect(viaOf(cheap)).toEqual(["AUH", "BLR"]);
    expect(show({ hiddenVia: ["DEL"] })).toEqual([391]);
  });

  it("filters on bags, excess baggage and terminal changes", () => {
    expect(show({ bagsConfirmed: true })).toEqual([391, 950]);
    expect(show({ noExcessBaggage: true })).toEqual([950, 560]);
    expect(show({ noTerminalChange: true })).toEqual([391, 950]);
  });

  it("offers each choice with how many trips use it and the cheapest price", () => {
    const f = facetsOf(all);
    expect(f.ukAirports.map((x) => x.code).sort()).toEqual(["LHR", "MAN"]);
    expect(f.airlines.find((a) => a.code === "AI")).toMatchObject({ count: 2, fromGbp: 560 });
    expect(f.via.find((v) => v.code === "DEL")).toMatchObject({ count: 2, fromGbp: 560 });
    expect(f.stops).toEqual([1, 2]);
    expect(f.price).toEqual({ min: 391, max: 950 });
    expect(f.hasOne && f.hasSeparate).toBe(true);
  });
});
