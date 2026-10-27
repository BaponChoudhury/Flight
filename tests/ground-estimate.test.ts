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

  it("lands within published fares on sample routes", () => {
    const LEEDS = { lat: 53.7955, lon: -1.5479 };
    const BIRMINGHAM = { lat: 52.4778, lon: -1.8999 };
    const COVENTRY = { lat: 52.4081, lon: -1.5106 };
    const leedsMan = estimateGround(LEEDS, "MAN")!;
    expect(leedsMan.trainPerPerson).toBeGreaterThanOrEqual(14); // on the day ~£18
    expect(leedsMan.trainPerPerson).toBeLessThanOrEqual(22);
    expect(leedsMan.coachPerPerson).toBeLessThanOrEqual(9); // £4–7
    expect(leedsMan.cabTotal).toBeGreaterThanOrEqual(75); // ~£80–90
    expect(leedsMan.cabTotal).toBeLessThanOrEqual(115);
    const bhamMan = estimateGround(BIRMINGHAM, "MAN")!;
    expect(bhamMan.trainPerPerson).toBeGreaterThanOrEqual(20); // ~£24
    expect(bhamMan.trainPerPerson).toBeLessThanOrEqual(28);
    const covBhx = estimateGround(COVENTRY, "BHX")!.cabTotal;
    expect(covBhx).toBeGreaterThanOrEqual(30); // metered ~£33, fixed £50–52
    expect(covBhx).toBeLessThanOrEqual(55);
    const bhamLhr = estimateGround(BIRMINGHAM, "LHR")!;
    expect(bhamLhr.cabTotal).toBeGreaterThanOrEqual(200); // £225–257
    expect(bhamLhr.cabTotal).toBeLessThanOrEqual(270);
    expect(bhamLhr.coachPerPerson).toBeLessThanOrEqual(25); // £8–25
  });

  it("has a floor for trips next door, and nothing for airports we can't place", () => {
    const next = estimateGround({ lat: 53.3537, lon: -2.275 }, "MAN")!;
    expect(next).toMatchObject({ trainPerPerson: 8, coachPerPerson: 5, cabTotal: 25 });
    expect(estimateGround(STAFFORD, "FRA")).toBeNull();
  });
});
