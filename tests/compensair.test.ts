import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApplication, newClaimRef, parseFlightNumber, submitApplication, type ClaimInput } from "@/lib/compensair";

const claim: ClaimInput = {
  disruption: "delay",
  arrivalDelay: "over4",
  departure: "LHR",
  arrival: "DEL",
  date: "2026-10-20",
  flightNumber: "AI162",
  booking: "2g5hf1",
  name: "Asha Rao",
  email: "asha@example.com",
};
const TODAY = "2026-10-24";

describe("Compensair claims", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads flight numbers into airline code + 4 digits", () => {
    expect(parseFlightNumber("AI162")).toEqual({ airline: "AI", digits: "0162" });
    expect(parseFlightNumber("6e 2945")).toEqual({ airline: "6E", digits: "2945" });
    expect(parseFlightNumber("EY-74")).toEqual({ airline: "EY", digits: "0074" });
    expect(parseFlightNumber("162")).toBeNull();
    expect(parseFlightNumber("12345")).toBeNull();
  });

  it("builds the body Compensair documents, in its codes", () => {
    expect(buildApplication(claim, "fiabc", TODAY)).toEqual({
      name: "Asha Rao",
      email: "asha@example.com",
      departure: "lhr",
      arrival: "del",
      date: "2026-10-20",
      airline: "ai",
      flight: "0162",
      booking: "2G5HF1",
      disruption: 1,
      delay: 4,
      customTrackingId: "fiabc",
      language: "en",
    });
    const cancelled = buildApplication({ ...claim, disruption: "cancellation", arrivalDelay: "2to3", phone: "+44 7700 900123", description: "Cancelled at the gate" }, "x", TODAY);
    expect(cancelled).toMatchObject({ disruption: 2, delay: 2, phone: "+44 7700 900123", description: "Cancelled at the gate" });
    expect(buildApplication({ ...claim, disruption: "denied_boarding" }, "x", TODAY)).toMatchObject({ disruption: 3 });
  });

  it("accepts travel agents' long order numbers as the booking reference", () => {
    expect(buildApplication({ ...claim, booking: "1234 5678 9012 3456" }, "x", TODAY)).toMatchObject({ booking: "1234567890123456" });
  });

  it("explains what's missing instead of sending a claim Compensair would reject", () => {
    expect(buildApplication({ ...claim, departure: "" }, "x", TODAY)).toMatch(/airports/);
    expect(buildApplication({ ...claim, arrival: "LHR" }, "x", TODAY)).toMatch(/different/);
    expect(buildApplication({ ...claim, date: "2026-11-01" }, "x", TODAY)).toMatch(/future/);
    expect(buildApplication({ ...claim, flightNumber: "162" }, "x", TODAY)).toMatch(/flight number/);
    expect(buildApplication({ ...claim, booking: "AB" }, "x", TODAY)).toMatch(/booking reference/);
    expect(buildApplication({ ...claim, name: "Asha" }, "x", TODAY)).toMatch(/first and last name/);
    expect(buildApplication({ ...claim, email: "asha" }, "x", TODAY)).toMatch(/email/);
    expect(buildApplication({ ...claim, arrivalDelay: "soon" as never }, "x", TODAY)).toMatch(/how late/);
  });

  it("makes our reference from letters and digits only", () => {
    expect(newClaimRef(Date.parse("2026-10-24T12:00:00Z"), () => 0.5)).toMatch(/^fi[a-z0-9]+$/);
  });

  it("sends the claim with the partner token from the server environment", async () => {
    vi.stubEnv("COMPENSAIR_TOKEN", "partner-token");
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ id: "6a93" }), { status: 200 });
    });
    const app = buildApplication(claim, "fiabc", TODAY);
    if (typeof app === "string") throw new Error(app);
    expect(await submitApplication(app)).toEqual({ id: "6a93" });
    expect(sent[0].url).toBe("https://www.compensair.com/api/v1/applications/");
    expect(sent[0].body).toMatchObject({ token: "partner-token", flight: "0162", customTrackingId: "fiabc" });
  });

  it("refuses to send without a partner token", async () => {
    vi.stubEnv("COMPENSAIR_TOKEN", "");
    const app = buildApplication(claim, "fiabc", TODAY);
    if (typeof app === "string") throw new Error(app);
    await expect(submitApplication(app)).rejects.toThrow(/COMPENSAIR_TOKEN/);
  });
});
