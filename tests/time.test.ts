import { describe, expect, it } from "vitest";
import {
  addDays,
  crossesLocalMidnight,
  formatLocalTime,
  localDate,
  localHour,
  localToUtc,
  minutesBetween,
  parseInstant,
  tzOffsetMins,
} from "@/lib/engine/time";

describe("timezone maths", () => {
  it("knows UK summer/winter offsets and IST", () => {
    expect(tzOffsetMins(Date.parse("2026-07-01T12:00:00Z"), "Europe/London")).toBe(60);
    expect(tzOffsetMins(Date.parse("2026-12-01T12:00:00Z"), "Europe/London")).toBe(0);
    expect(tzOffsetMins(Date.parse("2026-12-01T12:00:00Z"), "Asia/Kolkata")).toBe(330);
  });

  it("converts local wall-clock times to UTC", () => {
    expect(localToUtc("2026-07-10T21:30", "Europe/London")).toBe("2026-07-10T20:30:00.000Z"); // BST
    expect(localToUtc("2026-12-10T21:30:00", "Europe/London")).toBe("2026-12-10T21:30:00.000Z"); // GMT
    expect(localToUtc("2026-12-11T13:05:00", "Asia/Kolkata")).toBe("2026-12-11T07:35:00.000Z"); // IST +5:30
  });

  it("handles the night the UK clocks go back", () => {
    // 25 Oct 2026: 02:00 BST → 01:00 GMT. 03:00 local is GMT.
    expect(localToUtc("2026-10-25T03:00", "Europe/London")).toBe("2026-10-25T03:00:00.000Z");
    expect(localToUtc("2026-10-24T23:00", "Europe/London")).toBe("2026-10-24T22:00:00.000Z");
  });

  it("parses provider instants with and without offsets", () => {
    expect(parseInstant("2026-12-11T07:35:00Z")).toBe("2026-12-11T07:35:00.000Z");
    expect(parseInstant("2026-12-11T13:05:00+05:30")).toBe("2026-12-11T07:35:00.000Z");
    expect(parseInstant("2026-12-11T07:35:00")).toBe("2026-12-11T07:35:00.000Z"); // documented UTC field
    expect(parseInstant("2026-12-11T13:05:00", "Asia/Kolkata")).toBe("2026-12-11T07:35:00.000Z");
  });

  it("computes an overnight UK → India flight duration across timezones", () => {
    const dep = localToUtc("2026-12-10T21:30", "Europe/London");
    const arr = localToUtc("2026-12-11T11:00", "Asia/Kolkata");
    expect(minutesBetween(dep, arr)).toBe(8 * 60);
  });

  it("derives local dates/hours and midnight crossings in the hub timezone", () => {
    // 20:00Z = 01:30 IST next day
    expect(localDate("2026-12-10T20:00:00Z", "Asia/Kolkata")).toBe("2026-12-11");
    expect(localHour("2026-12-10T20:00:00Z", "Asia/Kolkata")).toBe(1);
    expect(formatLocalTime("2026-12-10T20:00:00Z", "Asia/Kolkata")).toBe("01:30");
    expect(crossesLocalMidnight("2026-12-10T17:00:00Z", "2026-12-10T19:00:00Z", "Asia/Kolkata")).toBe(true); // 22:30 → 00:30
    expect(crossesLocalMidnight("2026-12-10T17:00:00Z", "2026-12-10T19:00:00Z", "Europe/London")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
