import { describe, expect, it } from "vitest";
import { parseMins, toInput } from "@/components/GroundPanel";
import { airportPlaceName, groundLinks, mapsDirections } from "@/lib/ground-links";

describe("ground input parsing", () => {
  it("accepts minutes, h:mm, 1h20 and decimal hours", () => {
    expect(parseMins("80")).toBe(80);
    expect(parseMins("1:20")).toBe(80);
    expect(parseMins("1h20")).toBe(80);
    expect(parseMins("1h 20m")).toBe(80);
    expect(parseMins("2h")).toBe(120);
    expect(parseMins("1.5")).toBe(90);
    expect(parseMins("75 mins")).toBe(75);
    expect(parseMins("")).toBeNull();
    expect(parseMins("soon")).toBeNull();
  });

  it("treats blank or invalid prices as not entered", () => {
    expect(toInput({ trainPerPerson: "20", trainMins: "1:20", coachPerPerson: "9.5", coachMins: "2h10", cabTotal: "", cabMins: "x", use: "cheapest" })).toEqual({
      trainPerPerson: 20, trainMins: 80, coachPerPerson: 9.5, coachMins: 130, cabTotal: null, cabMins: null, use: "cheapest",
    });
    expect(toInput({ trainPerPerson: "-5", trainMins: "", coachPerPerson: "", coachMins: "", cabTotal: "abc", cabMins: "", use: "cab" }).trainPerPerson).toBeNull();
  });
});

describe("check-price links", () => {
  it("pre-fills Google Maps with the home town and airport", () => {
    expect(airportPlaceName("MAN")).toBe("Manchester Airport");
    expect(airportPlaceName("LHR")).toBe("London Heathrow Airport");
    expect(airportPlaceName("ZZZ")).toBe("ZZZ airport");
    const url = new URL(mapsDirections("Stafford, Staffordshire", "Manchester Airport", "transit"));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ api: "1", origin: "Stafford, Staffordshire", destination: "Manchester Airport", travelmode: "transit" });
  });

  it("offers train, coach and cab lookups", () => {
    const l = groundLinks("Stafford", "BHX");
    expect(l.train[0]).toMatchObject({ prefilled: true });
    expect(new URL(l.train[0].href).searchParams.get("destination")).toBe("Birmingham Airport");
    expect(l.coach.map((x) => x.label)).toEqual(["National Express", "FlixBus"]);
    expect(new URL(l.cab[0].href).searchParams.get("travelmode")).toBe("driving");
    for (const x of [...l.train, ...l.coach, ...l.cab]) expect(x.href.startsWith("https://")).toBe(true);
  });
});

describe("any-airport origins", () => {
  it("omits the Maps origin so it starts from the user's location", () => {
    const url = new URL(mapsDirections("", "Frankfurt Airport", "transit"));
    expect(url.searchParams.has("origin")).toBe(false);
    expect(url.searchParams.get("destination")).toBe("Frankfurt Airport");
  });

  it("accepts departure airports without a home town", async () => {
    const { validateRequest } = await import("@/lib/engine/search");
    const base = { dest: "GAU", date: "2026-12-10", flexDays: 0 as const, adults: 1, children: 0, bags: 1 };
    expect(validateRequest({ ...base, originArea: "", ukAirports: ["FRA", "PAR"] })).toBeNull();
    expect(validateRequest({ ...base, originArea: "", ukAirports: [] })).toMatch(/travelling from/);
    expect(validateRequest({ ...base, originArea: "", ukAirports: ["FRA", "MUC", "CDG", "AMS", "DXB", "DOH"] })).toMatch(/1 and 5/);
  });
});
