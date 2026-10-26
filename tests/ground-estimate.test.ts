import { describe, expect, it } from "vitest";
import { estimateGround, straightKm } from "@/lib/ground-estimate";

const STAFFORD = { lat: 52.806, lon: -2.12 };

describe("door-to-door estimates", () => {
  it("measures straight-line distance", () => {
    expect(Math.round(straightKm(51.5074, -0.1278, 53.4808, -2.2426))).toBe(262); // London → Manchester
  });

  it("estimates more for further airports, train per person and cab per car", () => {
    const man = estimateGround(STAFFORD, "MAN")!;
    const lon = estimateGround(STAFFORD, "LON")!;
    expect(man.trainPerPerson).toBeGreaterThan(10);
    expect(man.trainPerPerson).toBeLessThan(30);
    expect(lon.trainPerPerson).toBeGreaterThan(man.trainPerPerson);
    expect(lon.cabTotal).toBeGreaterThan(man.cabTotal);
    expect(man.coachPerPerson).toBeLessThan(man.trainPerPerson);
    expect(man.cabTotal).toBeGreaterThan(man.trainPerPerson * 3);
  });

  it("has a floor for trips next door, and nothing for airports we can't place", () => {
    const next = estimateGround({ lat: 53.3537, lon: -2.275 }, "MAN")!;
    expect(next).toMatchObject({ trainPerPerson: 6, coachPerPerson: 5, cabTotal: 15 });
    expect(estimateGround(STAFFORD, "FRA")).toBeNull();
  });
});
