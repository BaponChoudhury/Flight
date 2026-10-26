import { afterEach, describe, expect, it, vi } from "vitest";
import { initialDrafts } from "@/components/Results";
import type { SearchRequest, SearchResponse } from "@/lib/types";

const STAFFORD = { lat: 52.806, lon: -2.12 };
const option = (ukAirport: string, ground: Record<string, unknown>) => ({ ukAirport, ground }) as never;
const data = {
  options: [
    option("MAN", { mode: "train", cost_gbp: 20, per_person: true }), // Admin's fare for Stafford
    option("LCY", { mode: "not set", cost_gbp: 0, per_person: false }),
    option("BHX", { mode: "not set", cost_gbp: 0, per_person: false }),
  ],
} as unknown as SearchResponse;
const req = { originArea: "Stafford", originLatLon: STAFFORD } as SearchRequest;

describe("door-to-door starting fares", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gives every airport a starting fare, all marked as estimates", () => {
    const d = initialDrafts(data, req);
    expect(Object.keys(d).sort()).toEqual(["BHX", "LCY", "MAN"]);
    expect(d.MAN).toMatchObject({ trainPerPerson: "20", use: "train", estimated: true }); // Admin's fare, still an estimate
    expect(Number(d.MAN.cabTotal)).toBeGreaterThan(0); // other modes filled from the formula
    expect(d.LCY).toMatchObject({ use: "train", estimated: true }); // London City is now known
    expect(Number(d.LCY.trainPerPerson)).toBeGreaterThan(Number(d.BHX.trainPerPerson));
  });

  it("keeps what the user typed, and ignores saved rows with no prices", () => {
    const saved = { BHX: { trainPerPerson: "", coachPerPerson: "", cabTotal: "", use: "cheapest" }, MAN: { trainPerPerson: "12", coachPerPerson: "", cabTotal: "", use: "train" } };
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(saved) });
    const d = initialDrafts(data, req);
    expect(d.MAN).toMatchObject({ trainPerPerson: "12", estimated: false });
    expect(d.BHX.estimated).toBe(true);
    expect(Number(d.BHX.trainPerPerson)).toBeGreaterThan(0);
  });

  it("has nothing to estimate from without a home location", () => {
    const d = initialDrafts(data, { originArea: "" } as SearchRequest);
    expect(Object.keys(d)).toEqual(["MAN"]); // only Admin's fare
  });
});
