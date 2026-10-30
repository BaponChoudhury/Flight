"use client";

import { useEffect, useMemo, useState } from "react";
import { applyGround, groundChoices, pickGround, rankOptions, refundableView, valueScores, withoutGround, type GroundChoice } from "@/lib/engine/rules";
import { formatDuration, formatLocalDay, formatLocalTime, localDate } from "@/lib/engine/time";
import type { Badge, BookingLink, FareTerms, FlightLeg, NormalisedSegment, ProviderId, RouteOption, SearchRequest, SearchResponse, Settings } from "@/lib/types";
import { activeCount, applyFilters, facetsOf, NO_FILTERS, type Filters } from "@/lib/filters";
import { AirportCompare } from "./AirportCompare";
import { TicketRules } from "./TicketRules";
import { FilterPanel } from "./FilterPanel";
import { FollowupOptIn, type OptedIn } from "./FollowupOptIn";
import { EMPTY_DRAFT, GroundPanel, toInput, type GroundDraft } from "./GroundPanel";
import { airlineName } from "@/lib/airline-names";
import { estimateGround } from "@/lib/ground-estimate";
import { AirlineLogo, card, Icon, type IconName } from "./ui";

const gbp2 = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const gbp = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

const BADGE: Record<Badge, { cls: string; icon: IconName; label?: string }> = {
  "Separate tickets": { cls: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-800", icon: "alert" },
  "Bags included": { cls: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-800", icon: "bag" },
  "Bag price unknown": { cls: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700", icon: "bag" },
  "Terminal change": { cls: "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-900/30 dark:text-violet-200 dark:ring-violet-800", icon: "swap" },
  Overnight: { cls: "bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-200 dark:ring-indigo-800", icon: "clock" },
  "Excess baggage risk": { cls: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-800", icon: "bag", label: "Bag weight limit" },
  "Price not confirmed": { cls: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700", icon: "info" },
  Refundable: { cls: "bg-teal-50 text-teal-800 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-200 dark:ring-teal-800", icon: "refund" },
};

function BadgeChip({ b }: { b: Badge }) {
  const s = BADGE[b];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      <Icon name={s.icon} className="h-3.5 w-3.5" />
      {s.label ?? b}
    </span>
  );
}

/** "Refundable before departure (fee £120) · changes allowed", from the seller's fare rules. */
function fareTermsText(t: FareTerms): string | null {
  const parts: string[] = [];
  if (t.refundable === true) parts.push(`Refundable before departure${t.refundFeeGbp ? ` (fee about ${gbp(t.refundFeeGbp)})` : ""}`);
  else if (t.refundable === false) parts.push("Non-refundable");
  if (t.changeable === true) parts.push("date changes allowed");
  else if (t.changeable === false) parts.push("no date changes");
  return parts.length ? parts.join(" · ") : null;
}

// Which fare source (Ignav / Aviasales) each result came from, plus error and call details that
// name our sources. Hidden from users; set NEXT_PUBLIC_SHOW_SOURCE_TAGS=1 (and redeploy) to see them while testing.
const SHOW_SOURCE_TAGS = process.env.NEXT_PUBLIC_SHOW_SOURCE_TAGS === "1";
const SOURCE_NAME: Record<ProviderId, string> = { ignav: "Ignav", aviasales: "Aviasales", duffel: "Duffel" };

function SourceTag({ providers, others }: { providers: ProviderId[]; others?: RouteOption["otherPrices"] }) {
  if (!SHOW_SOURCE_TAGS || !providers.length) return null;
  const names = [...new Set(providers)].map((p) => SOURCE_NAME[p] ?? p).join(" + ");
  const also = (others ?? []).map((x) => `${SOURCE_NAME[x.provider] ?? x.provider} ${gbp(x.totalGbp)}${x.seller ? ` (${x.seller})` : ""}`);
  return (
    <span className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:border-slate-600 dark:text-slate-400">
      via {names}
      {also.length > 0 && ` · also ${also.join(", ")}`}
    </span>
  );
}

type Tz = Record<string, string>;
const UK_TZ = "Europe/London";
const when = (utc: string, tz: string) => `${formatLocalTime(utc, tz)} ${formatLocalDay(utc, tz)}`;
const dayDiff = (fromUtc: string, fromTz: string, toUtc: string, toTz: string) =>
  Math.round((Date.parse(`${localDate(toUtc, toTz)}T00:00:00Z`) - Date.parse(`${localDate(fromUtc, fromTz)}T00:00:00Z`)) / 86_400_000);

const segsOf = (legs: FlightLeg[]) => legs.flatMap((l) => l.itinerary.segments);
const tzOf = (s: NormalisedSegment, end: "dep" | "arr", tz: Tz) =>
  (end === "dep" ? (s.departTz ?? tz[s.origin]) : (s.arriveTz ?? tz[s.dest])) ?? (end === "dep" ? UK_TZ : "Asia/Kolkata");

/** Selling airlines' names, in flight order (segment carrier names can be the operating airline on a codeshare). */
function airlineNames(legs: FlightLeg[]): string {
  const names: string[] = [];
  for (const l of legs)
    for (const s of l.itinerary.segments) {
      const n = airlineName(s.carrier, l.itinerary.carrier === s.carrier ? l.itinerary.carrierName : null);
      if (!names.includes(n)) names.push(n);
    }
  return names.join(" · ");
}

/** One direction as big travel sites show it: logos, times, a line with a dot per stop, stops underneath. */
function JourneyRow({ legs, tz, hub, separate }: { legs: FlightLeg[]; tz: Tz; hub: string | null; separate: boolean }) {
  const segs = segsOf(legs);
  const first = segs[0];
  const last = segs[segs.length - 1];
  const depTz = tzOf(first, "dep", tz);
  const arrTz = tzOf(last, "arr", tz);
  const plus = dayDiff(first.departUtc, depTz, last.arriveUtc, arrTz);
  const via = segs.slice(1).map((s) => s.origin);
  const mins = Math.round((Date.parse(last.arriveUtc) - Date.parse(first.departUtc)) / 60000);
  const carriers = [...new Set(segs.map((s) => s.carrier ?? "??"))];
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <div className="flex w-10 shrink-0 flex-col items-center gap-1">
        <AirlineLogo code={carriers[0]} size={32} />
        {carriers.length > 1 && <span className="text-[10px] font-semibold text-slate-500">+{carriers.length - 1}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="tabular text-lg font-bold leading-tight sm:text-xl">{formatLocalTime(first.departUtc, depTz)}</p>
            <p className="text-xs font-semibold text-slate-500">{first.origin}</p>
          </div>
          <div className="min-w-0 flex-1 px-1 text-center">
            <p className="text-xs text-slate-500">{formatDuration(mins)}</p>
            <div className="relative my-1 h-px bg-slate-300 dark:bg-slate-600">
              <div className="absolute inset-0 flex items-center justify-evenly">
                {via.map((v, i) => (
                  <span
                    key={`${v}-${i}`}
                    title={separate && v === hub ? `${v}: separate tickets, collect bags and check in again` : v}
                    className={`h-2 w-2 rounded-full ring-2 ring-white dark:ring-slate-900 ${separate && v === hub ? "bg-amber-500" : "bg-slate-400"}`}
                  />
                ))}
              </div>
              <Icon name="plane" className="absolute -right-1 -top-2 h-4 w-4 text-slate-400" />
            </div>
            <p className={`truncate text-xs ${via.length ? "text-slate-600 dark:text-slate-300" : "font-medium text-emerald-700 dark:text-emerald-400"}`}>
              {via.length ? `${via.length} stop${via.length > 1 ? "s" : ""} · ${via.join(", ")}` : "Direct"}
            </p>
          </div>
          <div>
            <p className="tabular text-lg font-bold leading-tight sm:text-xl">
              {formatLocalTime(last.arriveUtc, arrTz)}
              {plus > 0 && <sup className="ml-0.5 text-xs font-semibold text-rose-600">+{plus}</sup>}
            </p>
            <p className="text-xs font-semibold text-slate-500">{last.dest}</p>
          </div>
        </div>
        <p className="mt-1 truncate text-xs text-slate-500">{airlineNames(legs)}</p>
      </div>
    </div>
  );
}

function LegBlock({
  leg,
  tz,
  req,
  searchId,
  prompt,
  onWhereToBook,
}: {
  leg: FlightLeg;
  tz: Tz;
  req: SearchRequest;
  searchId: string;
  prompt?: React.ReactNode;
  onWhereToBook?: () => void;
}) {
  const it = leg.itinerary;
  const [links, setLinks] = useState<BookingLink[] | null>(null);
  const [lower, setLower] = useState<LowerPriceView | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState("");
  const via = it.segments.slice(0, -1).map((s) => s.dest);
  const flights = it.segments.map((s) => `${s.carrier ?? ""}${s.flightNumber ?? ""}`).filter(Boolean).join(", ");
  const airline = airlineNames([leg]);

  async function loadLinks() {
    setState("loading");
    onWhereToBook?.();
    const res = await fetch("/api/booking-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerRef: it.providerRef,
        searchId,
        bookingKey: it.bookingKey,
        priceGbp: it.price.totalGbp,
        refundable: it.fareTerms?.refundable === true,
        adults: req.adults,
        children: req.children,
        infants: req.infants ?? 0,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "Failed");
      setState("error");
      return;
    }
    setLinks(data.links);
    setLower(data.lowerPrice ?? null);
    setState("idle");
  }

  return (
    <li className="relative pb-5 pl-8">
      <span className="absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white">
        <Icon name="plane" className="h-3.5 w-3.5" strokeWidth={2.2} />
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <AirlineLogo code={it.segments[0]?.carrier ?? it.carrier ?? "??"} size={20} />
        <p className="font-semibold">
          {it.origin} {when(it.departUtc, tz[it.origin] ?? UK_TZ)} <span className="text-slate-400">→</span> {it.dest} {when(it.arriveUtc, tz[it.dest] ?? UK_TZ)}
        </p>
        <SourceTag providers={[it.provider]} />
      </div>
      <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
        {airline} · {flights} · {formatDuration(it.durationMins)} · {via.length ? `stops in ${via.join(", ")}` : "direct"}
      </p>
      <p className="mt-0.5 text-sm">
        {leg.bundled ? "Fare included above" : <strong>Fare {gbp(it.price.totalGbp)}</strong>}
        {!leg.bundled && it.price.fxApprox && <span className="text-slate-500"> (converted from {it.price.currency} {it.price.amount.toFixed(0)})</span>} · {leg.bag.note}
        {leg.bag.excessRisk && leg.bag.includedKg != null && (
          <span className="text-rose-700 dark:text-rose-300">
            {" "}· allowance usually {leg.bag.includedKg}kg per bag{req.bagKg != null ? `, yours are ${req.bagKg}kg` : " — pack lighter or expect excess fees"}
          </span>
        )}
      </p>
      {!leg.bundled && (it.seller || it.fareTerms) && (
        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
          {[it.seller && `Price from ${it.seller}`, it.fareTerms && fareTermsText(it.fareTerms)].filter(Boolean).join(" · ")}
        </p>
      )}
      {prompt && (state !== "idle" || links !== null) && <div className="mt-2">{prompt}</div>}
      <div className="mt-2">
        {leg.bundled ? (
          <p className="text-sm text-slate-500">Booked together with the flight above.</p>
        ) : links === null ? (
          <button
            type="button"
            onClick={loadLinks}
            disabled={state === "loading"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-600 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-60 dark:border-brand-400 dark:text-brand-200 dark:hover:bg-brand-900/30"
          >
            {state === "loading" ? "Finding where to book…" : "Where to book"}
            <Icon name="chevronRight" className="h-4 w-4" />
          </button>
        ) : links.length === 0 ? (
          !lower && <p className="text-sm text-slate-500">No booking links available for this flight.</p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-700">
            {links.slice(0, 5).map((l, i) => (
              <li key={i}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span className="min-w-0">
                    <span className="font-semibold">{l.providerName}</span>
                    {l.fareName && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-700">{l.fareName}</span>}
                    {!l.exactFlight && <span className="ml-2 text-xs text-slate-500">search page</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {l.price && l.price.amount > 0 && <span className="tabular font-bold">{l.price.currency === "GBP" ? gbp(l.price.amount) : `${l.price.currency} ${l.price.amount.toFixed(0)}`}</span>}
                    <span className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white">
                      Book <Icon name="external" className="h-3.5 w-3.5" />
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {lower && <LowerPriceOffer offer={lower} req={req} />}
        {state === "error" && <p className="text-sm text-rose-700">{err}</p>}
      </div>
    </li>
  );
}

interface LowerPriceView {
  quoteId: string;
  priceGbp: number;
  ukPriceGbp: number | null;
  savingGbp: number | null;
  fareName: string | null;
  expiresAt: string;
}

const formField = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base dark:border-slate-600 dark:bg-slate-800";

/** A cheaper price our team can book for the customer. Where it comes from is deliberately not shown. */
function LowerPriceOffer({ offer, req }: { offer: LowerPriceView; req: SearchRequest }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const until = new Date(offer.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const res = await fetch("/api/fare-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteId: offer.quoteId, contact: { name: form.name, email: form.email, phone: form.phone }, notes: form.notes }),
    });
    const d = await res.json();
    if (!res.ok) {
      setMessage(d.error ?? "Something went wrong.");
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  return (
    <div className="mt-3 rounded-xl bg-emerald-50 p-4 text-sm ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:ring-emerald-800">
      <p className="flex items-center gap-2 font-semibold text-emerald-900 dark:text-emerald-100">
        <Icon name="sparkle" className="h-4 w-4" />
        We can book this for {gbp2(offer.priceGbp)} for {travellers(req)}
        {offer.savingGbp != null && ` — save ${gbp2(offer.savingGbp)}`}
      </p>
      {offer.ukPriceGbp != null && (
        <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">UK booking sites currently charge {gbp2(offer.ukPriceGbp)} for these flights.</p>
      )}
      <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">
        Same flights{offer.fareName ? ` (${offer.fareName})` : ""}. We book this fare for you. Price held until {until}; we confirm it with you before taking any payment.
      </p>
      {status === "sent" ? (
        <p className="mt-2 font-medium">Thanks — request received. We&apos;ll contact you shortly to confirm the price and your details. Nothing has been charged.</p>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">
          Request this fare
        </button>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <input required aria-label="Your name" placeholder="Your name" className={formField} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input required type="email" aria-label="Email" placeholder="Email" className={formField} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input required type="tel" aria-label="Phone" placeholder="Phone, e.g. +44 7700 900123" className={formField} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <textarea aria-label="Notes" placeholder="Anything we should know? (optional)" className={formField} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <button type="submit" disabled={status === "sending"} className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
            {status === "sending" ? "Sending…" : "Send request"}
          </button>
          {status === "error" && <p className="text-rose-700">{message}</p>}
        </form>
      )}
    </div>
  );
}

/** Airports inside a leg where the airline changes (possible ticket breaks in a self-transfer combo). */
function airlineChanges(leg: FlightLeg): string[] {
  const segs = leg.itinerary.segments;
  return segs.slice(0, -1).filter((s, i) => s.carrier !== segs[i + 1].carrier).map((s) => s.dest);
}

function travellers(req: SearchRequest) {
  const parts = [`${req.adults} adult${req.adults > 1 ? "s" : ""}`];
  if (req.children) parts.push(`${req.children} child${req.children > 1 ? "ren" : ""}`);
  if (req.infants) parts.push(`${req.infants} infant${req.infants > 1 ? "s" : ""}`);
  return parts.join(", ");
}

function ConnectionStep({ c }: { c: NonNullable<RouteOption["connection"]> }) {
  return (
    <li className="relative pb-5 pl-8">
      <span className="absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700">
        <Icon name="clock" className="h-3.5 w-3.5" strokeWidth={2.2} />
      </span>
      <p className="font-semibold">{formatDuration(c.bufferMins)} to change at {c.airport}</p>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Needs at least {formatDuration(c.minRequiredMins)}
        {c.terminalChange && ` including a terminal change (${c.terminalChange.from} → ${c.terminalChange.to})`}
        {c.overnight && " · overnight wait"}
      </p>
    </li>
  );
}

function PointStep({ icon, title, children, tone = "slate" }: { icon: IconName; title: string; children?: React.ReactNode; tone?: "slate" | "emerald" }) {
  const ring = tone === "emerald" ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200";
  return (
    <li className="relative pb-5 pl-8 last:pb-0">
      <span className={`absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full ${ring}`}>
        <Icon name={icon} className="h-3.5 w-3.5" strokeWidth={2.2} />
      </span>
      <p className="font-semibold">{title}</p>
      {children && <div className="text-sm text-slate-600 dark:text-slate-400">{children}</div>}
    </li>
  );
}

const legsOf = (o: RouteOption) => (o.back ? [...o.legs, ...o.back.legs] : o.legs);

const modeLabel = (m: string) => ({ train: "Train", coach: "Coach", cab: "Cab" })[m] ?? m;

const LABEL_STYLE: Record<string, string> = {
  Cheapest: "bg-emerald-600 text-white",
  Fastest: "bg-violet-600 text-white",
  Best: "bg-brand-600 text-white",
};

function ResultCard({ o, tz, req, labels, groundAlts, searchId }: { o: RouteOption; tz: Tz; req: SearchRequest; labels: string[]; groundAlts: GroundChoice[]; searchId: string }) {
  const other = groundAlts.find((g) => g.mode !== o.ground.mode);
  const [open, setOpen] = useState(false);
  // One opt-in per trip, shown in the details and again when the traveller asks where to book.
  const [optedIn, setOptedIn] = useState<OptedIn | null>(null);
  const [prompted, setPrompted] = useState(false);
  const optIn = (prompt: boolean) => <FollowupOptIn o={o} searchId={searchId} done={optedIn} onDone={setOptedIn} prompt={prompt} />;
  const destTz = tz[o.dest] ?? "Asia/Kolkata";
  // Home-side times are shown in the departure airport's timezone (not always the UK).
  const homeTz = tz[o.ukAirport] ?? UK_TZ;
  const backHomeTz = o.back ? (tz[o.back.legs[o.back.legs.length - 1].itinerary.dest] ?? homeTz) : homeTz;
  const c = o.connection;
  const separate = o.badges.includes("Separate tickets");
  const timeline = "relative before:absolute before:bottom-3 before:left-3 before:top-3 before:w-px before:bg-slate-200 dark:before:bg-slate-700";

  return (
    <article className={`${card} overflow-hidden transition hover:shadow-md ${labels.length ? "ring-2 ring-brand-500/40 dark:ring-brand-500/40" : ""}`}>
      {labels.length > 0 && (
        <div className="flex gap-1.5 px-4 pt-3 sm:px-5">
          {labels.map((l) => (
            <span key={l} className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${LABEL_STYLE[l]}`}>{l}</span>
          ))}
        </div>
      )}
      <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_11rem] sm:p-5">
        <div className="min-w-0 space-y-4">
          <JourneyRow legs={o.legs} tz={tz} hub={o.hub} separate={separate} />
          {o.back && <JourneyRow legs={o.back.legs} tz={tz} hub={o.hub} separate={separate} />}
          <div className="flex flex-wrap gap-1.5">
            {o.badges.map((b) => <BadgeChip key={b} b={b} />)}
            <SourceTag providers={[...o.legs, ...(o.back?.legs ?? [])].map((l) => l.itinerary.provider)} others={o.otherPrices} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4 sm:flex-col sm:items-end sm:justify-center sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0 dark:border-slate-800">
          <div className="sm:text-right">
            <p className="tabular text-2xl font-extrabold tracking-tight sm:text-3xl">
              {gbp(o.costs.total)}
              {o.costs.bagsUnknown && <span className="text-lg">+</span>}
            </p>
            <p className="text-xs text-slate-500">
              {req.adults + req.children > 1 ? `total, ${travellers(req)}` : "total per adult"}
              {o.back ? " · return" : ""}
            </p>
            {o.ground.mode !== "not set" && (
              <p
                title={`Door to door: flights ${gbp(o.costs.total - o.costs.ground)} plus ${o.ground.estimated ? "about " : ""}${gbp(o.costs.ground)} ${modeLabel(o.ground.mode).toLowerCase()} to ${o.ukAirport}${o.back ? " and back" : ""}${o.ground.estimated ? " (estimate)" : ""}`}
                className="mt-1 inline-flex flex-col rounded-md bg-teal-50 px-1.5 py-0.5 text-[11px] text-teal-800 sm:items-end dark:bg-teal-900/30 dark:text-teal-200"
              >
                <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wide">
                  <Icon name="train" className="h-3 w-3" />
                  Door to door
                </span>
                <span className="whitespace-nowrap">
                  flights {gbp(o.costs.total - o.costs.ground)} + {o.ground.estimated ? "~" : ""}
                  {gbp(o.costs.ground)} {modeLabel(o.ground.mode).toLowerCase()}
                </span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen((x) => !x)}
            aria-expanded={open}
            className={`flex items-center gap-1 rounded-xl px-5 py-2.5 text-sm font-bold transition ${open ? "bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100" : "bg-brand-600 text-white shadow-md shadow-brand-600/20 hover:bg-brand-700"}`}
          >
            {open ? "Hide" : "Select"}
            <Icon name="chevronDown" className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-5 border-t border-slate-100 bg-slate-50/60 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-950/40">
          {o.kind === "split" && (
            <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-100 dark:ring-amber-800">
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>Separate tickets:</strong> if your first flight is late and you miss the second, the second airline doesn&apos;t have to help — you may need to buy a new ticket. You&apos;ll also collect your bags and check in again at {o.hub}{o.back && " (both ways)"}
                {o.legs[1]?.bundled && airlineChanges(o.legs[0]).length > 0 && `, and probably at ${airlineChanges(o.legs[0]).join(", ")} where the airline changes`}.
              </span>
            </p>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Outbound</h3>
              <ol className={timeline}>
                <PointStep icon="home" title={`Be at ${o.ukAirport} by ${when(o.leaveHomeUtc, homeTz)}`}>
                  {o.ground.mode === "not set" ? (
                    <>Travel to {o.ukAirport} not added yet — add it under &quot;Getting to the airport&quot;.</>
                  ) : (
                    <>
                      {modeLabel(o.ground.mode)} from {req.originArea || "home"} to {o.ukAirport} · {o.ground.estimated ? "about " : ""}{gbp(o.costs.ground)}
                      {o.ground.notes ? ` (${o.ground.notes})` : ""}
                      {other && (
                        <span className="block">
                          Or {modeLabel(other.mode).toLowerCase()}: {gbp(other.costGbp)} ({other.costGbp > o.costs.ground ? "+" : "−"}
                          {gbp(Math.abs(other.costGbp - o.costs.ground))})
                        </span>
                      )}
                    </>
                  )}
                </PointStep>
                <LegBlock leg={o.legs[0]} tz={tz} req={req} searchId={searchId} prompt={optIn(true)} onWhereToBook={() => setPrompted(true)} />
                {c && <ConnectionStep c={c} />}
                {o.legs.slice(1).map((l, i) => <LegBlock key={`${l.itinerary.providerRef}-${i}`} leg={l} tz={tz} req={req} searchId={searchId} prompt={optIn(true)} onWhereToBook={() => setPrompted(true)} />)}
                <PointStep icon="pin" tone="emerald" title={`Arrive ${o.dest} ${when(o.arriveUtc, destTz)}`} />
              </ol>

              {o.back && (
                <>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Return</h3>
                  <ol className={timeline}>
                    <LegBlock leg={o.back.legs[0]} tz={tz} req={req} searchId={searchId} prompt={optIn(true)} onWhereToBook={() => setPrompted(true)} />
                    {o.back.connection && <ConnectionStep c={o.back.connection} />}
                    {o.back.legs.slice(1).map((l, i) => <LegBlock key={`back-${l.itinerary.providerRef}-${i}`} leg={l} tz={tz} req={req} searchId={searchId} prompt={optIn(true)} onWhereToBook={() => setPrompted(true)} />)}
                    <PointStep icon="home" title={`Out of the airport ${when(o.back.arriveHomeUtc, backHomeTz)}`}>
                      {o.ground.mode === "not set"
                        ? `About 1h to get through ${o.back.legs[o.back.legs.length - 1].itinerary.dest} airport; travel home not added yet.`
                        : `About 1h to get through the airport, then ${modeLabel(o.ground.mode).toLowerCase()} home`}
                    </PointStep>
                  </ol>
                </>
              )}
            </div>

            <div className="space-y-3">
            <div className={`${card} h-fit p-4`}>
              <h3 className="mb-2 text-sm font-bold">Price breakdown</h3>
              <table className="w-full text-sm">
                <tbody className="[&_td]:py-1">
                  <tr>
                    <td className="text-slate-600 dark:text-slate-400">
                      {o.ground.mode === "not set" ? `Getting to ${o.ukAirport}` : `${modeLabel(o.ground.mode)} to ${o.ukAirport}`}
                      {o.back && " and back"}
                      {o.ground.estimated && " (estimate)"}
                    </td>
                    <td className="tabular text-right">{o.ground.mode === "not set" ? "not added" : gbp(o.costs.ground)}</td>
                  </tr>
                  {o.costs.fares.map((f, i) => {
                    const l = legsOf(o)[i];
                    const returnFare = o.back && i === 0 && o.back.legs.some((b) => b.itinerary.providerRef === l.itinerary.providerRef);
                    return (
                      <tr key={i}>
                        <td className="text-slate-600 dark:text-slate-400">Flight {l.itinerary.origin} → {l.itinerary.dest}{returnFare && " (return fare)"}</td>
                        <td className="tabular text-right">{l.bundled ? "included" : gbp(f)}</td>
                      </tr>
                    );
                  })}
                  {req.bags > 0 && (
                    <tr><td className="text-slate-600 dark:text-slate-400">Checked bags ({req.bags} each)</td><td className="text-right">{o.costs.bagsUnknown ? "not confirmed" : "included"}</td></tr>
                  )}
                  {o.costs.excessBaggage > 0 && <tr><td className="text-slate-600 dark:text-slate-400">Likely excess baggage</td><td className="tabular text-right">{gbp(o.costs.excessBaggage)}</td></tr>}
                  <tr className="border-t border-slate-200 font-bold dark:border-slate-700">
                    <td className="pt-2">Total, {travellers(req)}</td>
                    <td className="tabular pt-2 text-right text-base">{gbp(o.costs.total)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">Price as of {formatLocalTime(o.priceAsOf, UK_TZ)} UK time. Fares change — check before booking.</p>
            </div>
            <TicketRules o={o} req={req} tz={tz} />
            {(!prompted || optedIn) && optIn(false)}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function draftKey(originArea: string) {
  return `ground:${originArea}`;
}

const hasPrice = (d: GroundDraft) => !!(d.trainPerPerson.trim() || d.coachPerPerson.trim() || d.cabTotal.trim());

/**
 * Start from what the user typed last time on this device; otherwise from Admin's fares for
 * this home area, then our distance-based estimate. Anything the user didn't type is marked
 * as an estimate. Saved rows with no prices in them are ignored.
 */
export function initialDrafts(data: SearchResponse, req: SearchRequest): Record<string, GroundDraft> {
  let saved: Record<string, GroundDraft> = {};
  try {
    saved = JSON.parse(localStorage.getItem(draftKey(req.originArea)) ?? "{}");
  } catch {
    /* storage unavailable */
  }
  const drafts: Record<string, GroundDraft> = {};
  // Older saved drafts predate some fields (e.g. coach) or have travel times; keep just the prices.
  for (const [a, d] of Object.entries(saved)) {
    const draft = { trainPerPerson: d.trainPerPerson ?? "", coachPerPerson: d.coachPerPerson ?? "", cabTotal: d.cabTotal ?? "", use: d.use ?? "cheapest", estimated: d.estimated === true };
    if (hasPrice(draft)) drafts[a] = draft;
  }
  const home = req.originLatLon;
  for (const a of new Set(data.options.map((o) => o.ukAirport))) {
    if (drafts[a]) continue;
    const e = home ? estimateGround(home, a) : null;
    const draft: GroundDraft = e
      ? { trainPerPerson: String(e.trainPerPerson), coachPerPerson: String(e.coachPerPerson), cabTotal: String(e.cabTotal), use: "train", estimated: true }
      : { ...EMPTY_DRAFT };
    // Admin's fare for this home area, if any, beats the distance formula (still an estimate to the user).
    const configured = data.options.find((o) => o.ukAirport === a && o.ground.mode !== "not set")?.ground;
    if (configured?.mode === "train" && configured.per_person) Object.assign(draft, { trainPerPerson: String(configured.cost_gbp), use: "train", estimated: true });
    if (configured?.mode === "cab" && !configured.per_person) Object.assign(draft, { cabTotal: String(configured.cost_gbp), use: "cab", estimated: true });
    if (hasPrice(draft)) drafts[a] = draft;
  }
  return drafts;
}

type SortBy = "best" | "cheapest" | "fastest";
const PAGE = 10;

export function Results({ data, req, settings }: { data: SearchResponse; req: SearchRequest; settings: Settings }) {
  const [priceWeight, setPriceWeight] = useState(0.6);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("best");
  const [visible, setVisible] = useState(PAGE);
  useEffect(() => setFilters(NO_FILTERS), [data]);
  useEffect(() => setVisible(PAGE), [data, filters, sortBy]);
  const refundableOnly = filters.refundableOnly;
  const pax = req.adults + req.children;
  const airports = useMemo(() => [...new Set(data.options.map((o) => o.ukAirport))].sort(), [data.options]);
  const [drafts, setDrafts] = useState<Record<string, GroundDraft>>({});
  // Off by default: prices start as flights only, like other sites, and the user opts in.
  const [doorToDoor, setDoorToDoor] = useState(false);
  useEffect(() => setDrafts(initialDrafts(data, req)), [data, req]);
  function updateDraft(airport: string, d: GroundDraft) {
    const next = { ...drafts, [airport]: d };
    setDrafts(next);
    try {
      localStorage.setItem(draftKey(req.originArea), JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  }

  // Stitch the user's train/cab prices into every option, then rank.
  const alts = useMemo(() => {
    const m: Record<string, GroundChoice[]> = {};
    for (const a of airports) m[a] = groundChoices(toInput(drafts[a] ?? EMPTY_DRAFT), pax);
    return m;
  }, [airports, drafts, pax]);
  // The refundable filter swaps each option for its refundable fare, if it has one: no new search.
  const shown = useMemo(
    () => (refundableOnly ? data.options.flatMap((o) => refundableView(o) ?? []) : data.options),
    [data.options, refundableOnly],
  );
  const options = useMemo(
    () =>
      shown.map((o) => {
        if (!doorToDoor) return withoutGround(o);
        const draft = drafts[o.ukAirport] ?? EMPTY_DRAFT;
        const choice = pickGround(toInput(draft), pax);
        if (!choice) return withoutGround(o);
        const priced = applyGround(o, choice, settings.uk_airport_arrival_mins, settings.uk_arrival_exit_mins ?? 60);
        return draft.estimated ? { ...priced, ground: { ...priced.ground, estimated: true } } : priced;
      }),
    [shown, doorToDoor, drafts, pax, settings.uk_airport_arrival_mins, settings.uk_arrival_exit_mins],
  );
  const facets = useMemo(() => (options.length ? facetsOf(options) : null), [options]);
  const filtered = useMemo(() => applyFilters(options, filters, data.airportTz), [options, filters, data.airportTz]);
  // The airport comparison follows every filter except the airport one, so all airports stay comparable.
  const comparable = useMemo(() => applyFilters(options, { ...filters, hiddenUkAirports: [] }, data.airportTz), [options, filters, data.airportTz]);
  const focusedAirport = useMemo(() => {
    const all = [...new Set(comparable.map((o) => o.ukAirport))];
    const shownAirports = all.filter((a) => !filters.hiddenUkAirports.includes(a));
    return shownAirports.length === 1 && all.length > 1 ? shownAirports[0] : null;
  }, [comparable, filters.hiddenUkAirports]);
  const focusAirport = (a: string | null) =>
    setFilters({ ...filters, hiddenUkAirports: a ? [...new Set(comparable.map((o) => o.ukAirport))].filter((x) => x !== a) : [] });
  const ranked = useMemo(() => rankOptions(filtered, priceWeight, settings), [filtered, priceWeight, settings]);
  const sorted = useMemo(() => {
    if (sortBy === "cheapest") return [...filtered].sort((a, b) => Number(a.costs.bagsUnknown) - Number(b.costs.bagsUnknown) || a.costs.total - b.costs.total);
    if (sortBy === "fastest") return [...filtered].sort((a, b) => a.totalMins - b.totalMins || a.costs.total - b.costs.total);
    const scores = valueScores(filtered, priceWeight, settings);
    return filtered.map((o, i) => ({ o, s: scores[i] })).sort((a, b) => a.s - b.s).map((x) => x.o);
  }, [filtered, sortBy, priceWeight, settings]);
  const tz = data.airportTz;
  const s = data.stats;
  const asOf = data.options.map((o) => o.priceAsOf).sort()[0];
  const labelsFor = (o: RouteOption) =>
    [o === ranked.bestValue && "Best", o === ranked.cheapest && "Cheapest", o === ranked.fastest && "Fastest"].filter((x): x is string => !!x);

  const tabs: { id: SortBy; label: string; o: RouteOption | null }[] = [
    { id: "best", label: "Best", o: ranked.bestValue },
    { id: "cheapest", label: "Cheapest", o: ranked.cheapest },
    { id: "fastest", label: "Fastest", o: ranked.fastest },
  ];

  return (
    <section className="space-y-4">
      {data.errors.length > 0 && (
        <div role="alert" className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-100 dark:ring-amber-800">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Some searches didn&apos;t complete, so a few routes may be missing.</p>
            {/* Error details name our flight sources: shown only while testing. */}
            {SHOW_SOURCE_TAGS && <ul className="mt-0.5 list-disc pl-5 text-amber-900/80 dark:text-amber-100/80">{data.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          </div>
        </div>
      )}

      {data.options.length === 0 ? (
        <div className={`${card} p-8 text-center`}>
          <Icon name="search" className="mx-auto h-8 w-8 text-slate-400" />
          <p className="mt-2 font-semibold">No flights found for these dates</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">Try another date, a nearby airport, or a longer change time under More options.</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
          <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
            <button
              type="button"
              className={`${card} flex w-full items-center justify-between px-4 py-3 text-left font-semibold lg:hidden`}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((x) => !x)}
            >
              <span className="flex items-center gap-2">
                <Icon name="sliders" className="h-5 w-5 text-brand-600" />
                Filters
                {activeCount(filters) > 0 && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs text-white">{activeCount(filters)}</span>}
              </span>
              <span className="text-sm font-normal text-slate-500">
                {filtered.length} of {data.options.length} <Icon name="chevronDown" className={`inline h-4 w-4 transition ${filtersOpen ? "rotate-180" : ""}`} />
              </span>
            </button>
            <div className={`${filtersOpen ? "mt-2 block" : "hidden"} ${card} p-4 lg:mt-0 lg:block`}>
              {facets && <FilterPanel filters={filters} facets={facets} onChange={setFilters} shownCount={filtered.length} totalCount={data.options.length} />}
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            <GroundPanel originArea={req.originArea} airports={airports} drafts={drafts} pax={pax} onChange={updateDraft} returnTrip={!!req.returnDate} on={doorToDoor} onToggle={setDoorToDoor} />

            <AirportCompare options={comparable} focused={focusedAirport} onFocus={focusAirport} doorToDoor={doorToDoor} onDoorToDoor={() => setDoorToDoor(true)} />

            {filtered.length === 0 ? (
              <div className={`${card} p-6 text-center`}>
                <p className="font-semibold">
                  {refundableOnly && !options.length ? "No refundable fares found" : "No results match these filters"}
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  {refundableOnly && !options.length
                    ? "Refund rules aren't available for every fare, and split tickets can't always be checked."
                    : "Try removing a filter or two."}
                </p>
                <button type="button" className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700" onClick={() => setFilters(NO_FILTERS)}>
                  Reset filters
                </button>
              </div>
            ) : (
              <>
                <div role="tablist" aria-label="Sort results" className={`${card} grid grid-cols-3 overflow-hidden p-1`}>
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={sortBy === t.id}
                      onClick={() => setSortBy(t.id)}
                      className={`rounded-xl px-2 py-2.5 text-left transition sm:px-4 ${sortBy === t.id ? "bg-brand-600 text-white shadow" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                    >
                      <p className={`text-sm font-bold ${sortBy === t.id ? "" : "text-slate-900 dark:text-white"}`}>{t.label}</p>
                      {t.o && (
                        <p className={`tabular truncate text-xs sm:text-sm ${sortBy === t.id ? "text-white/85" : "text-slate-500"}`}>
                          {gbp(t.o.costs.total)} · {formatDuration(t.o.totalMins)}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
                {sortBy === "best" && (
                  <div className="flex items-center gap-3 px-1 text-xs text-slate-600 dark:text-slate-400">
                    <span className="shrink-0 font-semibold">Best balances</span>
                    <span>time</span>
                    <input
                      aria-label="Balance between journey time and price"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={priceWeight}
                      onChange={(e) => setPriceWeight(Number(e.target.value))}
                      className="h-1 flex-1"
                    />
                    <span>price</span>
                  </div>
                )}

                <div className="space-y-3">
                  {sorted.slice(0, visible).map((o) => (
                    <ResultCard key={o.id} o={o} tz={tz} req={req} labels={labelsFor(o)} groundAlts={alts[o.ukAirport] ?? []} searchId={data.searchId} />
                  ))}
                </div>
                {sorted.length > visible && (
                  <button
                    type="button"
                    onClick={() => setVisible((v) => v + PAGE)}
                    className={`${card} w-full py-3 text-sm font-semibold text-brand-700 hover:bg-slate-50 dark:text-brand-300 dark:hover:bg-slate-800`}
                  >
                    Show more results ({sorted.length - visible} more)
                  </button>
                )}
              </>
            )}

            <details className="rounded-xl px-1 text-xs text-slate-500">
              <summary className="cursor-pointer select-none">Search details</summary>
              <div className="mt-2 space-y-1">
                <p>
                  {data.options.length} options
                  {SHOW_SOURCE_TAGS && ` · ${s.paidByProvider?.ignav ?? s.paidCalls} Ignav calls used${s.paidByProvider?.aviasales != null ? ` · ${s.paidByProvider.aviasales} Aviasales searches` : ""} · ${s.cacheHits} from cache${s.failedCalls > 0 ? ` · ${s.failedCalls} failed` : ""}`}{" "}
                  · {(s.durationMs / 1000).toFixed(1)}s
                </p>
                {asOf && <p>Prices as of {formatLocalTime(asOf, UK_TZ)} UK time (cached up to {settings.cache_ttl_mins / 60}h).</p>}
                {SHOW_SOURCE_TAGS && data.storage === "memory" && <p className="text-amber-700">Supabase not connected: cache resets when the server restarts.</p>}
                {data.notes.length > 0 && <ul className="list-disc pl-5">{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
              </div>
            </details>
          </div>
        </div>
      )}
    </section>
  );
}
