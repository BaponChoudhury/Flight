import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFollowup, compensairCheckUrl, compensairFrameSrc, renderFollowupEmail, type TripFollowup } from "@/lib/followups";
import { sendDueFollowups } from "@/lib/followups-send";
import { createMemoryStore } from "@/lib/store";

const NOW = new Date("2026-10-26T12:00:00Z");
const trip = {
  origin: "MAN",
  dest: "GAU",
  flights: [
    { carrier: "EY", flightNumber: "074", from: "MAN", to: "AUH", departUtc: "2026-11-22T13:50:00Z", arriveUtc: "2026-11-22T20:35:00Z" },
    { carrier: "EY", flightNumber: "1012", from: "AUH", to: "BLR", departUtc: "2026-11-22T22:05:00Z", arriveUtc: "2026-11-23T03:10:00Z" },
    { carrier: "IX", flightNumber: "2945", from: "BLR", to: "GAU", departUtc: "2026-11-23T10:15:00Z", arriveUtc: "2026-11-23T13:25:00Z" },
  ],
};
const optIn = { email: " Asha@Example.com ", consent: true, trip, searchId: "s1" };

describe("post-trip compensation follow-ups", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("saves an opt-in for the day after the last flight lands", () => {
    const f = buildFollowup(optIn, NOW) as TripFollowup;
    expect(f).toMatchObject({ email: "asha@example.com", send_after: "2026-11-24", sent_at: null, search_id: "s1" });
    expect(f.trip.flights[0]).toMatchObject({ carrier: "EY", flightNumber: "74" });
    expect(f.unsubscribe_token.length).toBeGreaterThan(20);
  });

  it("needs consent, a real email and real flights", () => {
    expect(buildFollowup({ ...optIn, consent: false }, NOW)).toMatch(/tick/);
    expect(buildFollowup({ ...optIn, email: "asha" }, NOW)).toMatch(/email/);
    expect(buildFollowup({ ...optIn, trip: { ...trip, flights: [] } }, NOW)).toMatch(/trip/);
    expect(buildFollowup({ ...optIn, trip: { ...trip, flights: [{ ...trip.flights[0], carrier: "Etihad" }] } }, NOW)).toMatch(/trip/);
    expect(buildFollowup(optIn, new Date("2026-12-01T00:00:00Z"))).toMatch(/already over/);
  });

  it("links each flight to Compensair's form, filled in", () => {
    const url = new URL(compensairCheckUrl({ ...trip.flights[2], flightNumber: "2945" }, "asha@example.com"));
    expect(url.origin + url.pathname).toBe("https://www.compensair.com/en/check-flight.html");
    expect(Object.fromEntries(new URLSearchParams(url.hash.slice(1)))).toEqual({
      date: "2026-11-23", airline: "ix", departure: "blr", arrival: "gau", flightNumber: "IX2945", email: "asha@example.com",
    });
  });

  it("fills in the claim page's iframe from known fields only", () => {
    expect(compensairFrameSrc({})).toBe("https://www.compensair.com/check-flight.html");
    expect(compensairFrameSrc({ date: "2026-11-23", flightNumber: "IX2945", evil: "x", airline: ["a", "b"] })).toBe(
      "https://www.compensair.com/check-flight.html#date=2026-11-23&flightNumber=IX2945",
    );
  });

  it("writes the email with a link per flight and an unsubscribe link", () => {
    const f = buildFollowup(optIn, NOW) as TripFollowup;
    const m = renderFollowupEmail(f, "https://site/unsubscribe?token=t", (c) => ({ GAU: "Guwahati", MAN: "Manchester" })[c] ?? c, "https://site");
    expect(m.subject).toBe("Was your flight to Guwahati on time?");
    expect(m.text).toContain("EY74 · Manchester → AUH");
    expect(m.text).toContain("https://site/unsubscribe?token=t");
    expect(m.html.match(/Check this flight/g)).toHaveLength(3);
    // Links go to our claim page (Compensair's partner iframe), without the email address.
    expect(m.text).toContain("https://site/claim?date=2026-11-23&airline=ix&departure=blr&arrival=gau&flightNumber=IX2945");
    expect(m.text).not.toContain("compensair.com/en/check-flight");
    expect(m.text).not.toContain("asha%40example.com");
  });

  it("sends due emails once, then forgets the address; unsubscribed trips get nothing", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Flights to India <alerts@example.com>");
    vi.stubEnv("SITE_URL", "https://site.example");
    const sent: { to: string[]; subject: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url === "https://api.resend.com/emails") {
        sent.push(JSON.parse(String(init.body)));
        return new Response("{}", { status: 200 });
      }
      throw new Error("no network in tests"); // airport names: falls back to codes
    });
    const store = createMemoryStore();
    const a = buildFollowup(optIn, NOW) as TripFollowup;
    const b = buildFollowup({ ...optIn, email: "other@example.com" }, NOW) as TripFollowup;
    await store.createFollowup(a);
    await store.createFollowup(b);
    expect(await store.unsubscribeFollowup(b.unsubscribe_token)).toBe(true);

    expect(await sendDueFollowups(store, "2026-11-23")).toMatchObject({ sent: 0 }); // not due yet
    expect(await sendDueFollowups(store, "2026-11-24")).toMatchObject({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["asha@example.com"]);
    expect(sent[0].headers["List-Unsubscribe"]).toBe(`<https://site.example/api/followups/unsubscribe?token=${encodeURIComponent(a.unsubscribe_token)}>`);
    expect(await sendDueFollowups(store, "2026-11-25")).toMatchObject({ sent: 0 }); // never twice
    const rows = await store.listFollowups();
    expect(rows.every((r) => r.email === null)).toBe(true);
  });

  it("does nothing until email is set up", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const store = createMemoryStore();
    await store.createFollowup(buildFollowup(optIn, NOW) as TripFollowup);
    expect(await sendDueFollowups(store, "2026-11-30")).toMatchObject({ sent: 0, skipped: expect.stringMatching(/RESEND_API_KEY/) });
  });
});
