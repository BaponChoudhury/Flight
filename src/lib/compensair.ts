// Compensair API 1.0 (https://www.compensair.com/en/api.html): submit flight-compensation
// claims for passengers and list the claims sent with our partner token.
// The token (COMPENSAIR_TOKEN) is server-side only. We keep no copy of passengers' details.

const BASE_URL = "https://www.compensair.com/api/v1/applications/";

export type Disruption = "delay" | "cancellation" | "denied_boarding";
export type ArrivalDelay = "under2" | "2to3" | "3to4" | "over4";

export interface ClaimInput {
  disruption: Disruption;
  arrivalDelay: ArrivalDelay;
  departure: string;
  arrival: string;
  date: string; // yyyy-mm-dd
  flightNumber: string; // e.g. "AI162" or "AI 0162"
  booking: string;
  name: string;
  email: string;
  phone?: string;
  description?: string;
}

/** The JSON body Compensair expects, without the token. */
export interface CompensairApplication {
  name: string;
  email: string;
  departure: string;
  arrival: string;
  date: string;
  airline: string;
  flight: string;
  booking: string;
  disruption: 1 | 2 | 3;
  delay: 1 | 2 | 3 | 4;
  customTrackingId: string;
  language: "en";
  phone?: string;
  description?: string;
}

const DISRUPTION: Record<Disruption, 1 | 2 | 3> = { delay: 1, cancellation: 2, denied_boarding: 3 };
const DELAY: Record<ArrivalDelay, 1 | 2 | 3 | 4> = { under2: 1, "2to3": 2, "3to4": 3, over4: 4 };

/** "AI162", "ai 0162", "6E-2945" → { airline: "AI", digits: "0162" }; Compensair wants 4 digits. */
export function parseFlightNumber(input: string): { airline: string; digits: string } | null {
  const m = /^\s*([A-Z0-9]{2})\s*-?\s*(\d{1,4})\s*[A-Z]?\s*$/i.exec(input);
  if (!m || !/[A-Z]/i.test(m[1])) return null;
  return { airline: m[1].toUpperCase(), digits: m[2].padStart(4, "0") };
}

/** Checks a claim and turns it into Compensair's format; returns an error message instead if something's wrong. */
export function buildApplication(c: ClaimInput, trackingId: string, today = new Date().toISOString().slice(0, 10)): CompensairApplication | string {
  const iata = (s: string) => (typeof s === "string" && /^[A-Za-z]{3}$/.test(s.trim()) ? s.trim().toLowerCase() : null);
  const departure = iata(c.departure);
  const arrival = iata(c.arrival);
  if (!departure || !arrival) return "Pick the departure and arrival airports.";
  if (departure === arrival) return "Departure and arrival airports must be different.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date ?? "") || Number.isNaN(Date.parse(c.date))) return "Enter the flight date.";
  if (c.date > today) return "The flight date can't be in the future.";
  const flight = parseFlightNumber(c.flightNumber ?? "");
  if (!flight) return "Enter the flight number as shown on your ticket, e.g. AI162.";
  if (!(c.disruption in DISRUPTION)) return "Choose what happened to your flight.";
  if (!(c.arrivalDelay in DELAY)) return "Choose how late you arrived.";
  // An airline reference is usually 6 characters; travel agents' order numbers can be much longer.
  const booking = (c.booking ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(booking)) return "Enter your booking reference (the airline's 6-character code, or your travel agent's order number).";
  const name = (c.name ?? "").trim();
  if (name.length < 3 || !name.includes(" ")) return "Enter your first and last name.";
  const email = (c.email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  const phone = (c.phone ?? "").trim();
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) return "Enter your phone number in international format, e.g. +44 7700 900123.";
  return {
    name: name.slice(0, 120),
    email: email.slice(0, 200),
    departure,
    arrival,
    date: c.date,
    airline: flight.airline.toLowerCase(),
    flight: flight.digits,
    booking,
    disruption: DISRUPTION[c.disruption],
    delay: DELAY[c.arrivalDelay],
    customTrackingId: trackingId,
    language: "en",
    ...(phone ? { phone } : {}),
    ...(c.description?.trim() ? { description: c.description.trim().slice(0, 2000) } : {}),
  };
}

/** Our own reference for a claim, sent as Compensair's customTrackingId: letters and digits only. */
export function newClaimRef(now = Date.now(), random = Math.random): string {
  const rand = Array.from({ length: 4 }, () => Math.floor(random() * 36).toString(36)).join("");
  return `fi${now.toString(36)}${rand}`;
}

export const compensairConfigured = () => !!process.env.COMPENSAIR_TOKEN;

export class CompensairError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "CompensairError";
  }
}

export async function submitApplication(app: CompensairApplication): Promise<unknown> {
  const token = process.env.COMPENSAIR_TOKEN;
  if (!token) throw new CompensairError("COMPENSAIR_TOKEN is not set on the server", null);
  let res: Response;
  try {
    res = await fetch(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ ...app, token }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new CompensairError(`Could not reach Compensair: ${(err as Error).message}`, null);
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON reply */
  }
  if (!res.ok) throw new CompensairError(`Compensair returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`, res.status);
  return body;
}

/** A claim as Compensair lists it (GET /applications). */
export interface CompensairCase {
  id: string;
  customTrackingId: string | null;
  clickId: string | null;
  receptionDate: string | null;
  departure: string | null;
  arrival: string | null;
  airline: string | null;
  flightDate: string | null;
  flight: string | null;
  disruption: string | null;
  totalCompensation: number | string | null;
  test: number;
  duplicate: number;
  applicationType: string | null;
  stage: string | null;
}

/** Claims received between `start` and `end` (yyyy-mm-dd), newest first. */
export async function listApplications(start: string, end: string): Promise<{ total: number; cases: CompensairCase[] }> {
  const token = process.env.COMPENSAIR_TOKEN;
  if (!token) throw new CompensairError("COMPENSAIR_TOKEN is not set on the server", null);
  const url = `${BASE_URL}?${new URLSearchParams({ token, start_time: start, end_time: end })}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new CompensairError(`Compensair returned HTTP ${res.status}`, res.status);
  const d = (await res.json()) as { total?: number; cases?: CompensairCase[] };
  const cases = [...(d.cases ?? [])].sort((a, b) => (b.receptionDate ?? "").localeCompare(a.receptionDate ?? ""));
  return { total: d.total ?? cases.length, cases };
}
