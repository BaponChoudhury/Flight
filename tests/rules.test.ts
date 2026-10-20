import { describe, expect, it } from "vitest";
import { defaultConfig } from "@/lib/config/defaults";
import { aggregateCosts, assessBags, checkConnection, groundCost, rankOptions } from "@/lib/engine/rules";
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

  it("treats included bags as free but flags weight over the domestic allowance", () => {
    const b = assessBags(dom("2026-12-11T10:00:00Z", "6E"), "domestic", req, config);
    expect(b.status).toBe("included");
    expect(b.feeGbp).toBe(0);
    expect(b.excessRisk).toBe(true); // 23kg > 15kg
    expect(b.excessGbp).toBe((23 - 15) * 6 * 2);
  });

  it("adds the configured fee per missing bag per traveller", () => {
    const noBag = itin({ origin: "LHR", dest: "DEL", departUtc: "2026-12-10T21:30:00Z", arriveUtc: "2026-12-11T05:30:00Z", gbp: 300, carrier: "BA", checked: 0 });
    const b = assessBags(noBag, "international", req, config);
    expect(b).toMatchObject({ status: "fee", feeGbp: 65 * 2, excessRisk: false });
  });

  it("marks bag price unknown when there is no fee and no data", () => {
    const noBag = itin({ origin: "LHR", dest: "DEL", departUtc: "2026-12-10T21:30:00Z", arriveUtc: "2026-12-11T05:30:00Z", gbp: 300, carrier: "ZZ", checked: 0 });
    expect(assessBags(noBag, "international", req, config).status).toBe("unknown");
    const unknown = { ...noBag, baggage: { checkedPieces: null, carryOnPieces: null } };
    expect(assessBags(unknown, "international", req, config).status).toBe("unknown");
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
