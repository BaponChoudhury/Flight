// Post-trip compensation follow-ups: a traveller opts in when booking, and the day after
// their last flight lands we email them a link to check for compensation (Compensair).
// Email goes out through Resend once RESEND_API_KEY and EMAIL_FROM are set.

import { randomBytes } from "node:crypto";

export interface FollowupFlight {
  carrier: string; // IATA code, e.g. "AI"
  flightNumber: string; // digits, e.g. "162"
  from: string;
  to: string;
  departUtc: string;
  arriveUtc: string;
}

export interface FollowupTrip {
  origin: string;
  dest: string;
  flights: FollowupFlight[];
}

export interface TripFollowup {
  id: string;
  created_at: string;
  email: string | null; // wiped once sent or unsubscribed
  trip: FollowupTrip;
  send_after: string; // yyyy-mm-dd (UTC)
  sent_at: string | null;
  unsubscribed_at: string | null;
  unsubscribe_token: string;
  search_id: string | null;
}

const IATA = /^[A-Z]{3}$/;
const CARRIER = /^[A-Z0-9]{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Checks an opt-in from the results page; returns a ready-to-save follow-up, or an error message. */
export function buildFollowup(
  input: { email?: unknown; consent?: unknown; trip?: unknown; searchId?: unknown },
  now = new Date(),
): TripFollowup | string {
  if (input.consent !== true) return "Please tick the box to agree.";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 200) return "Enter a valid email address.";
  const t = input.trip as Partial<FollowupTrip> | undefined;
  if (!t || !IATA.test(t.origin ?? "") || !IATA.test(t.dest ?? "") || !Array.isArray(t.flights) || !t.flights.length || t.flights.length > 12)
    return "Missing trip details.";
  const flights: FollowupFlight[] = [];
  for (const f of t.flights as Partial<FollowupFlight>[]) {
    const carrier = String(f.carrier ?? "").toUpperCase();
    const flightNumber = String(f.flightNumber ?? "").replace(/^0+/, "");
    if (!CARRIER.test(carrier) || !/^\d{1,4}$/.test(flightNumber) || !IATA.test(f.from ?? "") || !IATA.test(f.to ?? "")) return "Missing trip details.";
    if (Number.isNaN(Date.parse(f.departUtc ?? "")) || Number.isNaN(Date.parse(f.arriveUtc ?? ""))) return "Missing trip details.";
    flights.push({ carrier, flightNumber, from: f.from!, to: f.to!, departUtc: new Date(f.departUtc!).toISOString(), arriveUtc: new Date(f.arriveUtc!).toISOString() });
  }
  const lastArrival = Math.max(...flights.map((f) => Date.parse(f.arriveUtc)));
  if (lastArrival < now.getTime() - 86_400_000) return "This trip is already over.";
  return {
    id: `fu_${randomBytes(9).toString("hex")}`,
    created_at: now.toISOString(),
    email,
    trip: { origin: t.origin!, dest: t.dest!, flights },
    send_after: new Date(lastArrival + 86_400_000).toISOString().slice(0, 10),
    sent_at: null,
    unsubscribed_at: null,
    unsubscribe_token: randomBytes(18).toString("base64url"),
    search_id: typeof input.searchId === "string" ? input.searchId.slice(0, 64) : null,
  };
}

/** Our name on Compensair's partner iframe: claims made through it are credited to us. */
export const COMPENSAIR_PARTNER = "bilal_choudhury";

/** Fields Compensair's claim form fills in from "#param=…" (their documented links). */
export const COMPENSAIR_PREFILL = ["date", "airline", "departure", "arrival", "flightNumber", "email", "typeOfDisruption"] as const;

/** Compensair's claim form with this flight filled in (their documented "#param=…" links). */
export function compensairCheckUrl(f: FollowupFlight, email: string | null): string {
  const params = new URLSearchParams({
    date: f.departUtc.slice(0, 10),
    airline: f.carrier.toLowerCase(),
    departure: f.from.toLowerCase(),
    arrival: f.to.toLowerCase(),
    flightNumber: `${f.carrier}${f.flightNumber}`,
    ...(email ? { email } : {}),
  });
  return `https://www.compensair.com/en/check-flight.html#${params}`;
}

/**
 * Our claim page with this flight filled in. It shows Compensair's form in our partner iframe,
 * so the claim is credited to us (a direct link to Compensair isn't). The email address stays
 * out of the link so it never lands in our server logs.
 */
export function claimPageUrl(site: string, f: FollowupFlight): string {
  return `${site}/claim?${new URL(compensairCheckUrl(f, null)).hash.slice(1)}`;
}

/** The iframe address for our claim page, filled in from its query string (known fields only). */
export function compensairFrameSrc(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const k of COMPENSAIR_PREFILL) {
    const v = query[k];
    if (typeof v === "string" && v.length <= 100) params.set(k, v);
  }
  const hash = params.toString();
  return `https://www.compensair.com/check-flight.html${hash ? `#${hash}` : ""}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const day = (utc: string) => new Date(utc).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** The follow-up email. `cityOf` turns airport codes into names ("GAU" → "Guwahati"). */
export function renderFollowupEmail(f: TripFollowup, unsubscribeUrl: string, cityOf: (code: string) => string = (c) => c, site = siteUrl()) {
  const dest = cityOf(f.trip.dest);
  const subject = `Was your flight to ${dest} on time?`;
  const intro = `If any flight on your trip arrived 3+ hours late, was cancelled, or you were denied boarding, you could claim up to £520 under UK and EU rules.`;
  const rows = f.trip.flights.map((fl) => ({ label: `${fl.carrier}${fl.flightNumber} · ${cityOf(fl.from)} → ${cityOf(fl.to)} · ${day(fl.departUtc)}`, url: claimPageUrl(site, fl) }));
  const text = [
    subject,
    "",
    intro,
    "",
    "Check a flight (takes about 2 minutes, with our partner Compensair; their terms and fees apply):",
    ...rows.map((r) => `- ${r.label}: ${r.url}`),
    "",
    "Flights leaving the UK or EU qualify on any airline; flights into the UK or EU only on UK or EU airlines.",
    "",
    `You asked us to check this trip for compensation. Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#121c47;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:bold">Fly To Roots</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:22px">${esc(subject)}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${esc(intro)}</p>
${rows
  .map(
    (r) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;border:1px solid #e2e8f0;border-radius:12px"><tr>
<td style="padding:12px 14px;font-size:14px">${esc(r.label)}</td>
<td align="right" style="padding:12px 14px"><a href="${esc(r.url)}" style="background:#2449e0;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:9px 14px;border-radius:8px;display:inline-block">Check this flight</a></td>
</tr></table>`,
  )
  .join("\n")}
<p style="margin:16px 0 0;font-size:13px;color:#64748b;line-height:1.5">Claims are handled by our partner Compensair; their terms and fees apply. Flights leaving the UK or EU qualify on any airline; flights into the UK or EU only on UK or EU airlines.</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">You asked us to check this trip for compensation when you searched for flights. <a href="${esc(unsubscribeUrl)}" style="color:#64748b">Unsubscribe</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text };
}

export const emailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;

/** Public address of the site, for links in emails sent outside a user request (the daily job). */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

export async function sendEmail(to: string, msg: { subject: string; html: string; text: string }, unsubscribeUrl: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
