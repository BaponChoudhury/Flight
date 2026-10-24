import { describe, expect, it } from "vitest";
import { defaultConfig } from "@/lib/config/defaults";
import { aggregateCosts, applyGround, assessBags, checkConnection, groundCost, pickGround, rankOptions } from "@/lib/engine/rules";
import type { FlightLeg } from "@/lib/types";
import { itin } from "./helpers";

const config = defaultConfig();
const IST = "Asia/Kolkata";
const opts = { minBufferMins: 210, allowOvernight: false };

// International lands DEL 05:30Z (11:00 IST).
const intl = itin({ origin: "LHR", dest: "DEL", departUtc: "2026-12-10T21:30:00Z", arriveUtc: "2026-12-11T05:30:00Z", gbp: 400, carrier: "AI" });
const dom = (departUtc: string, carrier = "AI") =>
  itin({ origin: "DEL", dest: "GAU", departUtc, arriveUtc: new Date(Date.parse(departUtc) + 150 * 60000).toISOString(), gbp: 60, carrier });

describe("connection buffers", () => {
  it("accepts a connection at exactly the minimum buffer", () => {
    const r = checkConnection(intl, dom("2026-12-11T09:00:00Z"), "DEL", IST, config, opts); // 3h30m, same terminal (AI T3 → AI T3)
    expect(r.ok).toBe(true);
    expect(r.connection.bufferMins).toBe(210);
    expect(r.connection.terminalChange).toBeNull();
  });

  it("rejects a connection one minute short", () => {
    const r = checkConnection(intl, dom("2026-12-11T08:59:00Z"), "DEL", IST, config, opts);
    expect(r).toMatchObject({ ok: false, reason: "too_short" });
  });

  it("adds 45 minutes for DEL T3 → T1", () => {
    const tight = checkConnection(intl, dom("2026-12-11T09:30:00Z", "6E"), "DEL", IST, config, opts); // 4h00 < 3h30+45
    expect(tight.ok).toBe(false);
    expect(tight.connection.terminalChange).toEqual({ from: "T3", to: "T1" });
    expect(tight.connection.minRequiredMins).toBe(255);
    expect(checkConnection(intl, dom("2026-12-11T09:45:00Z", "6E"), "DEL", IST, config, opts).ok).toBe(true);
  });

  it("respects the user's chosen buffer", () => {
    const r = checkConnection(intl, dom("2026-12-11T10:00:00Z"), "DEL", IST, config, { ...opts, minBufferMins: 300 });
    expect(r.ok).toBe(false);
  });

  it("enforces the 14h max unless overnight is allowed, and prices the hotel", () => {
    // Arrive 11:00 IST, depart next morning 07:00 IST = 20h, crosses midnight.
    const late = dom("2026-12-12T01:30:00Z");
    expect(checkConnection(intl, late, "DEL", IST, config, opts)).toMatchObject({ ok: false, reason: "too_long" });
    const r = checkConnection(intl, late, "DEL", IST, config, { ...opts, allowOvernight: true });
    expect(r.ok).toBe(true);
    expect(r.connection.overnight).toBe(true);
    expect(r.connection.hotelGbp).toBe(40);
  });
});

describe("baggage", () => {
  const req = { bags: 1, bagKg: 23, adults: 2, children: 0 };
  const mk = (checked: number | null, carrier = "6E") =>
    itin({ origin: "DEL", dest: "GAU", departUtc: "2026-12-11T09:00:00Z", arriveUtc: "2026-12-11T11:30:00Z", gbp: 60, carrier, checked });

  it("treats bags Ignav confirms as included in the fare, and flags a 15kg domestic allowance", () => {
    const b = assessBags(mk(1), "domestic", req, config);
    expect(b).toMatchObject({ status: "included", feeGbp: 0, excessGbp: 0, excessRisk: true, includedKg: 15 });
  });

  it("never invents a bag fee: missing or unconfirmed bags are 'unknown'", () => {
    expect(assessBags(mk(0, "BA"), "international", req, config)).toMatchObject({ status: "unknown", feeGbp: 0 });
    expect(assessBags(mk(null, "ZZ"), "international", req, config)).toMatchObject({ status: "unknown", feeGbp: 0 });
    expect(assessBags(mk(1), "domestic", { ...req, bags: 2 }, config)).toMatchObject({ status: "unknown", feeGbp: 0 });
  });

  it("needs nothing when no checked bags are wanted", () => {
    expect(assessBags(mk(null), "domestic", { ...req, bags: 0 }, config)).toMatchObject({ status: "included", excessRisk: false });
  });
});

describe("cost aggregation", () => {
  it("sums ground + fares + bags + excess + hotel", () => {
    const legs: FlightLeg[] = [
      { routeType: "international", itinerary: intl, bag: { status: "fee", feeGbp: 130, excessGbp: 0, includedPieces: 0, includedKg: 23, excessRisk: false, note: "" } },
      { routeType: "domestic", itinerary: dom("2026-12-11T10:00:00Z"), bag: { status: "included", feeGbp: 0, excessGbp: 96, includedPieces: 1, includedKg: 15, excessRisk: true, note: "" } },
    ];
    const ground = groundCost(config.groundAccess.find((g) => g.airport === "LHR")!, 2);
    expect(ground).toBe(80);
    const c = aggregateCosts(ground, legs, 40);
    expect(c).toMatchObject({ ground: 80, fares: [400, 60], bags: 130, excessBaggage: 96, hotel: 40, total: 806, bagsUnknown: false });
  });

  it("charges per-party ground costs once", () => {
    expect(groundCost({ origin_area: "Stafford", airport: "MAN", mode: "car", cost_gbp: 50, per_person: false, duration_mins: 70, notes: "" }, 4)).toBe(50);
  });

  it("ranks cheapest, fastest and best value; unknown bags rank lower", () => {
    const mk = (total: number, totalMins: number, bagsUnknown = false) => ({ costs: { ground: 0, fares: [], bags: 0, excessBaggage: 0, hotel: 0, total, bagsUnknown }, totalMins });
    const a = mk(500, 1500), b = mk(800, 900), c = mk(450, 1600, true);
    const r = rankOptions([a, b, c], 0.5, config.settings);
    expect(r.cheapest).toBe(a); // c is cheaper but bag price unknown
    expect(r.fastest).toBe(b);
    expect(rankOptions([a, b, c], 1, config.settings).bestValue).toBe(a);
    expect(rankOptions([a, b, c], 0, config.settings).bestValue).toBe(b);
  });
});

describe("user-entered ground travel", () => {
  const input = { trainPerPerson: 20, coachPerPerson: null, cabTotal: 95, use: "cheapest" as const };

  it("prices train per person and cab per car, and picks the cheaper for the party", () => {
    expect(pickGround(input, 2)).toMatchObject({ mode: "train", costGbp: 40 });
    expect(pickGround(input, 5)).toMatchObject({ mode: "cab", costGbp: 95 }); // 5 × £20 = £100 > £95
    expect(pickGround({ ...input, use: "cab" }, 2)).toMatchObject({ mode: "cab" });
    expect(pickGround({ ...input, cabTotal: null, use: "cab" }, 2)).toBeNull();
    expect(pickGround({ trainPerPerson: null, coachPerPerson: null, cabTotal: null, use: "cheapest" }, 2)).toBeNull();
  });

  it("prices coach per person and can pick it", () => {
    const withCoach = { ...input, coachPerPerson: 12 };
    expect(pickGround(withCoach, 2)).toMatchObject({ mode: "coach", costGbp: 24 });
    expect(pickGround({ ...withCoach, use: "train" }, 2)).toMatchObject({ mode: "train" });
    expect(pickGround({ ...withCoach, use: "coach" }, 5)).toMatchObject({ mode: "coach", costGbp: 60 });
  });

  it("re-prices an option, timing it from the airport", async () => {
    const { buildOption } = await import("@/lib/engine/search");
    const leg: FlightLeg = { routeType: "international", itinerary: intl, bag: { status: "included", feeGbp: 0, excessGbp: 0, includedPieces: 1, includedKg: 23, excessRisk: false, note: "" } };
    const ground = { origin_area: "Stafford", airport: "LHR", mode: "train", cost_gbp: 40, per_person: true, duration_mins: 160, notes: "" };
    const req = { originArea: "Stafford", dest: "DEL", date: "2026-12-10", flexDays: 0 as const, adults: 2, children: 0, bags: 1, bagKg: 23 };
    const before = buildOption("through", [leg], ground, req, 180);
    expect(before.costs).toMatchObject({ ground: 80, total: 480 });

    const after = applyGround(before, { mode: "cab", costGbp: 150, detail: "whole car" }, 180);
    expect(after.costs).toMatchObject({ ground: 150, total: 550 });
    // Flight departs 21:30Z; be at the airport 3h earlier (no travel time is asked for).
    expect(after.leaveHomeUtc).toBe("2026-12-10T18:30:00.000Z");
    expect(after.totalMins).toBe(before.totalMins - 160);
    expect(after.ground.mode).toBe("cab");
  });
});
