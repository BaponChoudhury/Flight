import { describe, expect, it } from "vitest";
import { parseMins, toInput } from "@/components/GroundPanel";

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
    expect(toInput({ trainPerPerson: "20", trainMins: "1:20", cabTotal: "", cabMins: "x", use: "cheapest" })).toEqual({
      trainPerPerson: 20, trainMins: 80, cabTotal: null, cabMins: null, use: "cheapest",
    });
    expect(toInput({ trainPerPerson: "-5", trainMins: "", cabTotal: "abc", cabMins: "", use: "cab" }).trainPerPerson).toBeNull();
  });
});
