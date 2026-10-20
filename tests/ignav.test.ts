import { describe, expect, it } from "vitest";
import { defaultConfig } from "@/lib/config/defaults";
import { normaliseOneWay, type IgnavFareSearchResponse } from "@/lib/providers/ignav";

// Shape taken from a real /api/fares/one-way response (values trimmed).
const raw: IgnavFareSearchResponse = {
  origin: "MAN",
  destination: "BLR",
  departure_date: "2026-12-10",
  return_date: null,
  observed_at: "2026-10-20T09:12:00Z",
  itineraries: [
    {
      ignav_id: "abc",
      price: { amount: 900, currency: "GBP", status: "verified" },
      outbound: {
        carrier: "Etihad", // a name, not an IATA code
        duration_minutes: 655,
        segments: [
          {
            marketing_carrier_code: "EY",
            flight_number: "16",
            operating_carrier_name: "Etihad",
            departure_airport: "MAN",
            departure_time_local: "2026-12-10T13:50:00",
            departure_timezone: "Europe/London",
            departure_time_utc: "2026-12-10T13:50:00Z",
            arrival_airport: "AUH",
            arrival_time_local: "2026-12-11T00:35:00",
            arrival_timezone: "Asia/Dubai",
            arrival_time_utc: "2026-12-10T20:35:00Z",
            duration_minutes: 405,
            aircraft: null,
          },
        ],
      },
      bags: { carry_on: 1 },
      requires_self_transfer: false,
    },
  ],
};

describe("Ignav normalisation", () => {
  it("uses the segment IATA code for rules and keeps the airline name for display", () => {
    const [it0] = normaliseOneWay(raw, { fetchedAt: "2026-10-20T09:12:00Z", fromCache: false, passengers: 2 }, defaultConfig().settings).itineraries;
    expect(it0.carrier).toBe("EY");
    expect(it0.carrierName).toBe("Etihad");
    expect(it0.price.totalGbp).toBe(900); // Ignav prices cover the whole party
    expect(it0.baggage).toEqual({ checkedPieces: 0, carryOnPieces: 1 }); // carry-on listed, no checked count → none
    expect(it0.durationMins).toBe(655);
  });

  it("skips (never mis-times) a segment with neither a UTC time nor a timezone", () => {
    const broken = structuredClone(raw);
    const seg = broken.itineraries[0].outbound.segments[0];
    seg.departure_time_utc = null;
    seg.departure_timezone = null;
    const r = normaliseOneWay(broken, { fetchedAt: "x", fromCache: false, passengers: 2 }, defaultConfig().settings);
    expect(r.itineraries).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });

  it("falls back to local time + timezone when UTC is missing", () => {
    const partial = structuredClone(raw);
    partial.itineraries[0].outbound.segments[0].arrival_time_utc = null;
    const [it0] = normaliseOneWay(partial, { fetchedAt: "x", fromCache: false, passengers: 2 }, defaultConfig().settings).itineraries;
    expect(it0.arriveUtc).toBe("2026-12-10T20:35:00.000Z"); // 00:35 in Dubai (+4)
  });
});
