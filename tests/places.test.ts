import { describe, expect, it } from "vitest";
import { haversineKm, knownTz, nearestUkAirports, parseIndiaDestination } from "@/lib/config/places";
import { buildOneWayRequest } from "@/lib/providers/ignav";
import { defaultConfig } from "@/lib/config/defaults";
import { assessBags } from "@/lib/engine/rules";
import { itin } from "./helpers";

describe("nearest UK airports", () => {
  it("suggests BHX, MAN and London for Stafford", () => {
    const r = nearestUkAirports(52.8066, -2.1171); // Stafford
    expect(r.map((a) => a.code)).toEqual(["BHX", "MAN", "LON"]);
    expect(r[0].km).toBeLessThan(r[1].km);
  });

  it("suggests Scottish airports for Edinburgh and still offers London", () => {
    expect(nearestUkAirports(55.9533, -3.1883).map((a) => a.code)).toEqual(["EDI", "GLA", "LON"]);
  });

  it("only offers London when nothing regional is within range", () => {
    expect(nearestUkAirports(51.5, -0.12, 2, 10).map((a) => a.code)).toEqual(["LON"]);
  });

  it("measures distance sensibly", () => {
    expect(haversineKm(51.47, -0.4543, 53.3537, -2.275)).toBeGreaterThan(240); // LHR–MAN ≈ 246km
    expect(haversineKm(51.47, -0.4543, 53.3537, -2.275)).toBeLessThan(255);
  });
});

describe("destination input", () => {
  it("accepts a picked label, a code or a city name", () => {
    expect(parseIndiaDestination("Guwahati (GAU)")).toBe("GAU");
    expect(parseIndiaDestination("ixb")).toBe("IXB");
    expect(parseIndiaDestination("Guwahati")).toBe("GAU");
    expect(parseIndiaDestination("Bagdogra")).toBe("IXB");
    expect(parseIndiaDestination("Somewhere")).toBeNull();
  });

  it("knows UK and Indian timezones", () => {
    expect(knownTz("LON")).toBe("Europe/London");
    expect(knownTz("STN")).toBe("Europe/London");
    expect(knownTz("IMF")).toBe("Asia/Kolkata");
    expect(knownTz("DXB")).toBeNull();
  });
});

describe("infants and bags without a weight", () => {
  it("sends lap infants to Ignav", () => {
    const body = buildOneWayRequest("LON", "GAU", "2026-12-10", { adults: 2, children: 1, infants: 1, allowSelfTransfer: false }, defaultConfig().settings);
    expect(body).toMatchObject({ adults: 2, children: 1, infants_on_lap: 1, infants_in_seat: 0 });
  });

  it("flags a 15kg domestic allowance without inventing an excess cost", () => {
    const dom = itin({ origin: "DEL", dest: "GAU", departUtc: "2026-12-11T09:00:00Z", arriveUtc: "2026-12-11T11:30:00Z", gbp: 60, carrier: "6E" });
    const b = assessBags(dom, "domestic", { bags: 1, adults: 2, children: 0 }, defaultConfig());
    expect(b).toMatchObject({ status: "included", excessRisk: true, excessGbp: 0, includedKg: 15 });
  });
});
