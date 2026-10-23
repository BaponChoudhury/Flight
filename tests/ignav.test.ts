import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("booking links", () => {
  it("sends only the ignav_id (Ignav rejects passenger/market fields with it)", async () => {
    const { ignavProvider } = await import("@/lib/providers/ignav");
    let sent: unknown;
    const ctx = {
      settings: defaultConfig().settings,
      log: [],
      call: async (req: { body: unknown }) => {
        sent = req.body;
        return { raw: { itinerary: {}, booking_options: [] }, fetchedAt: "x", fromCache: false };
      },
    };
    await ignavProvider.getBookingLinks("abc123", { adults: 2, children: 1, infants: 1, allowSelfTransfer: false }, ctx as never);
    expect(sent).toEqual({ ignav_id: "abc123" });
  });

  it("falls back to the flight details when the ignav_id has expired", async () => {
    const { ignavProvider } = await import("@/lib/providers/ignav");
    const { ProviderError } = await import("@/lib/providers/types");
    const sent: unknown[] = [];
    const ctx = {
      settings: defaultConfig().settings,
      log: [],
      call: async (req: { body: { ignav_id?: string } }) => {
        sent.push(req.body);
        if (req.body.ignav_id) throw new ProviderError("No itinerary matched the provided flight details.", 404);
        return { raw: { itinerary: {}, booking_options: [{ legs: ["outbound"], links: [{ provider_name: "Etihad", url: "https://x" }] }] }, fetchedAt: "x", fromCache: false };
      },
    };
    const key = { origin: "MAN", dest: "BLR", date: "2026-12-10", carrier: "EY", flightNumber: "78", ret: { date: "2027-01-05", carrier: "EY", flightNumber: "273" } };
    const links = await ignavProvider.getBookingLinks("old", { adults: 2, children: 0, infants: 1, allowSelfTransfer: false }, ctx as never, key);
    expect(links.map((l) => l.providerName)).toEqual(["Etihad"]);
    expect(sent[1]).toMatchObject({
      origin: "MAN", destination: "BLR", departure_date: "2026-12-10", outbound_carrier_code: "EY", outbound_flight_number: "78",
      return_date: "2027-01-05", inbound_carrier_code: "EY", inbound_flight_number: "273", adults: 2, infants_on_lap: 1, market: "GB",
    });
  });

  it("records the flight details on normalised itineraries", () => {
    const [it0] = normaliseOneWay(raw, { fetchedAt: "x", fromCache: false, passengers: 2 }, defaultConfig().settings).itineraries;
    expect(it0.bookingKey).toEqual({ origin: "MAN", dest: "AUH", date: "2026-12-10", carrier: "EY", flightNumber: "16", flights: ["EY16"] });
  });

  it("rejects a lookup that came back with a different connection (GF8+GF130 instead of GF8+GF134)", async () => {
    const { bookingMatchesKey } = await import("@/lib/providers/ignav");
    const seg = (n: string, from: string, to: string) => ({
      marketing_carrier_code: "GF", flight_number: n, operating_carrier_name: "Gulf Air", departure_airport: from, departure_time_local: "2027-01-20T10:35:00",
      departure_timezone: null, departure_time_utc: null, arrival_airport: to, arrival_time_local: "2027-01-20T20:00:00", arrival_timezone: null, arrival_time_utc: null, duration_minutes: 1, aircraft: null,
    });
    const resp = (second: string) => ({
      itinerary: { price: { amount: 1, currency: "GBP", status: "verified" as const }, outbound: { carrier: "Gulf Air", duration_minutes: 1, segments: [seg("8", "LGW", "BAH"), seg(second, "BAH", "DEL")] } },
      booking_options: [],
    });
    const key = { origin: "LGW", dest: "DEL", date: "2027-01-20", carrier: "GF", flightNumber: "8", flights: ["GF8", "GF134"] };
    expect(bookingMatchesKey(resp("134"), key)).toBe(true);
    expect(bookingMatchesKey(resp("130"), key)).toBe(false);
    expect(bookingMatchesKey(resp("130"), { ...key, flights: undefined })).toBe(true); // older keys can't be checked
  });

  describe("retries", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.useRealTimers();
    });

    // Runs one real ignavPost (fetch stubbed) through a pass-through call context.
    async function searchWith(statuses: number[]) {
      const { ignavProvider } = await import("@/lib/providers/ignav");
      vi.stubEnv("IGNAV_API_KEY", "test");
      vi.useFakeTimers();
      const fetchMock = vi.fn(async () => {
        const status = statuses.shift() ?? 200;
        const body = status === 200 ? { ...raw, itineraries: [] } : { error: { message: "Unable to complete request." } };
        return new Response(JSON.stringify(body), { status });
      });
      vi.stubGlobal("fetch", fetchMock);
      const ctx = { settings: defaultConfig().settings, log: [], call: async (req: { fetcher: () => Promise<unknown> }) => ({ raw: await req.fetcher(), fetchedAt: "x", fromCache: false }) };
      const filters = { adults: 1, children: 0, infants: 0, allowSelfTransfer: false };
      const result = ignavProvider.searchOneWay("MAN", "GAU", "2026-11-22", filters, ctx as never).then(
        (v) => ({ ok: true as const, v }),
        (e: Error) => ({ ok: false as const, e }),
      );
      await vi.runAllTimersAsync();
      return { result: await result, calls: fetchMock.mock.calls.length };
    }

    it("retries a 424 once and uses the second answer", async () => {
      const { result, calls } = await searchWith([424, 200]);
      expect(result.ok).toBe(true);
      expect(calls).toBe(2);
    });

    it("gives up after one retry", async () => {
      const { result, calls } = await searchWith([424, 424, 200]);
      expect(result.ok).toBe(false);
      expect(calls).toBe(2);
    });

    it("doesn't retry a request Ignav rejected as invalid", async () => {
      const { result, calls } = await searchWith([422, 200]);
      expect(result.ok).toBe(false);
      expect(calls).toBe(1);
    });
  });
});
