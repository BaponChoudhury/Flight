"use client";

import { useEffect, useMemo, useState } from "react";
import { applyGround, groundChoices, pickGround, rankOptions, type GroundChoice } from "@/lib/engine/rules";
import { formatDuration, formatLocalDay, formatLocalTime } from "@/lib/engine/time";
import type { Badge, BookingLink, FlightLeg, RouteOption, SearchRequest, SearchResponse, Settings } from "@/lib/types";
import { EMPTY_DRAFT, GroundPanel, toInput, type GroundDraft } from "./GroundPanel";

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

const BADGE_STYLE: Record<Badge, string> = {
  "Separate tickets": "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  "Bags included": "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
  "Bag price unknown": "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  "Terminal change": "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200",
  Overnight: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-200",
  "Excess baggage risk": "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200",
  "Price not confirmed": "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
};

type Tz = Record<string, string>;
const UK_TZ = "Europe/London";
const when = (utc: string, tz: string) => `${formatLocalTime(utc, tz)} ${formatLocalDay(utc, tz)}`;

function routeLabel(o: RouteOption) {
  return o.kind === "split" ? `${o.ukAirport} → ${o.hub} → ${o.dest}` : `${o.ukAirport} → ${o.dest}`;
}

function LegBlock({ leg, tz, req }: { leg: FlightLeg; tz: Tz; req: SearchRequest }) {
  const it = leg.itinerary;
  const [links, setLinks] = useState<BookingLink[] | null>(null);
  const [lower, setLower] = useState<LowerPriceView | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState("");
  const via = it.segments.slice(0, -1).map((s) => s.dest);
  const flights = it.segments.map((s) => `${s.carrier ?? ""}${s.flightNumber ?? ""}`).filter(Boolean).join(", ");
  const airline = it.carrierName ?? it.segments[0]?.carrierName ?? it.carrier ?? "Airline";

  async function loadLinks() {
    setState("loading");
    const res = await fetch("/api/booking-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerRef: it.providerRef,
        bookingKey: it.bookingKey,
        priceGbp: it.price.totalGbp,
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
    <li className="relative border-l-2 border-sky-600 pl-4">
      <p className="font-semibold">
        ✈ {it.origin} {when(it.departUtc, tz[it.origin] ?? UK_TZ)} → {it.dest} {when(it.arriveUtc, tz[it.dest] ?? UK_TZ)}
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {airline} · {flights} · {formatDuration(it.durationMins)} · {via.length ? `stops in ${via.join(", ")}` : "direct"}
      </p>
      <p className="text-sm">
        {leg.bundled ? "Fare included above" : `Fare ${gbp(it.price.totalGbp)}`}
        {!leg.bundled && it.price.fxApprox && ` (converted from ${it.price.currency} ${it.price.amount.toFixed(0)})`} · {leg.bag.note}
        {leg.bag.excessRisk && leg.bag.includedKg != null && (
          <span className="text-rose-700 dark:text-rose-300">
            {" "}· allowance usually {leg.bag.includedKg}kg per bag{req.bagKg != null ? `, yours are ${req.bagKg}kg` : " — pack lighter or expect excess fees"}
          </span>
        )}
      </p>
      <div className="mt-1">
        {leg.bundled ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Booked with the flight above.</p>
        ) : links === null ? (
          <button type="button" onClick={loadLinks} disabled={state === "loading"} className="text-sm font-medium text-sky-700 underline dark:text-sky-400">
            {state === "loading" ? "Getting booking links…" : "Get booking links"}
          </button>
        ) : links.length === 0 ? (
          !lower && <p className="text-sm">No booking links available for this flight.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {links.slice(0, 5).map((l, i) => (
              <li key={i}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline dark:text-sky-400">
                  Book with {l.providerName}
                </a>
                {l.fareName && <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-xs dark:bg-slate-700">{l.fareName}</span>}
                {l.price && l.price.amount > 0 && ` · ${l.price.currency} ${l.price.amount.toFixed(0)}`}
                {!l.exactFlight && " (search page)"}
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
    <div className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-900/30">
      <p className="font-semibold text-emerald-900 dark:text-emerald-100">
        Lower price found: {gbp(offer.priceGbp)} for {travellers(req)}
        {offer.savingGbp != null && ` — save ${gbp(offer.savingGbp)}`}
      </p>
      <p className="text-emerald-900/80 dark:text-emerald-100/80">
        Same flights{offer.fareName ? ` (${offer.fareName})` : ""}. We book this fare for you. Price held until {until}; we confirm it with you before taking any payment.
      </p>
      {status === "sent" ? (
        <p className="mt-2 font-medium">Thanks — request received. We&apos;ll contact you shortly to confirm the price and your details. Nothing has been charged.</p>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 rounded-lg bg-emerald-700 px-3 py-2 font-semibold text-white">
          Request this fare
        </button>
      ) : (
        <form onSubmit={submit} className="mt-2 space-y-2">
          <input required aria-label="Your name" placeholder="Your name" className={formField} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input required type="email" aria-label="Email" placeholder="Email" className={formField} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input required type="tel" aria-label="Phone" placeholder="Phone, e.g. +44 7700 900123" className={formField} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <textarea aria-label="Notes" placeholder="Anything we should know? (optional)" className={formField} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <button type="submit" disabled={status === "sending"} className="rounded-lg bg-emerald-700 px-3 py-2 font-semibold text-white disabled:opacity-50">
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
    <li className="border-l-2 border-dashed border-amber-500 pl-4">
      <p className="font-semibold">⏱ {formatDuration(c.bufferMins)} at {c.airport}</p>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Needs at least {formatDuration(c.minRequiredMins)}
        {c.terminalChange && ` including a terminal change (${c.terminalChange.from} → ${c.terminalChange.to})`}
        {c.overnight && (c.hotelGbp ? ` · overnight, hotel about ${gbp(c.hotelGbp)}` : " · overnight wait")}
      </p>
    </li>
  );
}

const legsOf = (o: RouteOption) => (o.back ? [...o.legs, ...o.back.legs] : o.legs);

const modeLabel = (m: string) => ({ train: "Train", coach: "Coach", cab: "Cab" })[m] ?? m;

function OptionCard({ o, tz, req, highlight, groundAlts }: { o: RouteOption; tz: Tz; req: SearchRequest; highlight?: string; groundAlts: GroundChoice[] }) {
  const other = groundAlts.find((g) => g.mode !== o.ground.mode);
  const [open, setOpen] = useState(false);
  const destTz = tz[o.dest] ?? "Asia/Kolkata";
  // Home-side times are shown in the departure airport's timezone (not always the UK).
  const homeTz = tz[o.ukAirport] ?? UK_TZ;
  const backHomeTz = o.back ? (tz[o.back.legs[o.back.legs.length - 1].itinerary.dest] ?? homeTz) : homeTz;
  const c = o.connection;
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <button type="button" className="w-full text-left" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        {highlight && <p className="mb-1 text-xs font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400">{highlight}</p>}
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-2xl font-bold">{gbp(o.costs.total)}{o.costs.bagsUnknown && "+"}</span>
          <span className="text-right text-base font-medium">
            {o.back ? `${formatDuration(o.outMins)} out · ${formatDuration(o.back.totalMins)} back` : `${formatDuration(o.totalMins)} door to door`}
          </span>
        </div>
        <p className="mt-1 text-base">{routeLabel(o)}{o.back && " · return"}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {o.back && "Out: "}Leave home {when(o.leaveHomeUtc, homeTz)} · arrive {when(o.arriveUtc, destTz)}
        </p>
        {o.back && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Back: leave {o.dest} {when(o.back.leaveDestUtc, destTz)} · home {when(o.back.arriveHomeUtc, backHomeTz)}
          </p>
        )}
        {o.badges.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {o.badges.map((b) => <span key={b} className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STYLE[b]}`}>{b}</span>)}
          </div>
        )}
        <p className="mt-2 text-sm font-medium text-sky-700 dark:text-sky-400">{open ? "Hide details" : "Show details"}</p>
      </button>

      {open && (
        <div className="mt-3 space-y-4 border-t border-slate-200 pt-3 dark:border-slate-700">
          {o.kind === "split" && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
              <strong>Separate tickets:</strong> if your first flight is late and you miss the second, the second airline doesn&apos;t have to help — you may need to buy a new ticket. You&apos;ll also collect your bags and check in again at {o.hub}{o.back && " (both ways)"}
              {o.legs[1]?.bundled && airlineChanges(o.legs[0]).length > 0 && `, and probably at ${airlineChanges(o.legs[0]).join(", ")} where the airline changes`}.
            </p>
          )}
          <ol className="space-y-3">
            <li className="border-l-2 border-slate-400 pl-4">
              <p className="font-semibold">🏠 Leave {req.originArea || "home"} {when(o.leaveHomeUtc, homeTz)}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {o.ground.mode === "not set"
                  ? `Travel to ${o.ukAirport} not entered yet — add it under "Getting to the airport".`
                  : `${modeLabel(o.ground.mode)} to ${o.ukAirport}, about ${formatDuration(o.ground.duration_mins)} · ${gbp(o.costs.ground)}${o.ground.notes ? ` (${o.ground.notes})` : ""}`}
              </p>
              {other && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Or {modeLabel(other.mode).toLowerCase()}: {gbp(other.costGbp)}, about {formatDuration(other.mins)} ({other.costGbp > o.costs.ground ? "+" : "−"}
                  {gbp(Math.abs(other.costGbp - o.costs.ground))})
                </p>
              )}
            </li>
            <LegBlock leg={o.legs[0]} tz={tz} req={req} />
            {c && <ConnectionStep c={c} />}
            {o.legs.slice(1).map((l, i) => <LegBlock key={`${l.itinerary.providerRef}-${i}`} leg={l} tz={tz} req={req} />)}
            <li className="border-l-2 border-emerald-600 pl-4">
              <p className="font-semibold">📍 Arrive {o.dest} {when(o.arriveUtc, destTz)}</p>
            </li>
          </ol>

          {o.back && (
            <>
              <h3 className="font-semibold">Coming back</h3>
              <ol className="space-y-3">
                <LegBlock leg={o.back.legs[0]} tz={tz} req={req} />
                {o.back.connection && <ConnectionStep c={o.back.connection} />}
                {o.back.legs.slice(1).map((l, i) => <LegBlock key={`back-${l.itinerary.providerRef}-${i}`} leg={l} tz={tz} req={req} />)}
                <li className="border-l-2 border-slate-400 pl-4">
                  <p className="font-semibold">🏠 Home {when(o.back.arriveHomeUtc, backHomeTz)}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {o.ground.mode === "not set"
                      ? `About 1h to get through ${o.back.legs[o.back.legs.length - 1].itinerary.dest} airport; travel home not entered yet.`
                      : `About 1h to get through the airport, then ${modeLabel(o.ground.mode).toLowerCase()} home, about ${formatDuration(o.ground.duration_mins)}`}
                  </p>
                </li>
              </ol>
            </>
          )}

          <table className="w-full text-sm">
            <tbody>
              <tr>
                <td>{o.ground.mode === "not set" ? `Getting to ${o.ukAirport} (not entered)` : `${modeLabel(o.ground.mode)} to ${o.ukAirport}`}{o.back && " and back"}</td>
                <td className="text-right">{gbp(o.costs.ground)}</td>
              </tr>
              {o.costs.fares.map((f, i) => {
                const l = legsOf(o)[i];
                const returnFare = o.back && i === 0 && o.back.legs.some((b) => b.itinerary.providerRef === l.itinerary.providerRef);
                return (
                  <tr key={i}>
                    <td>Flight {l.itinerary.origin} → {l.itinerary.dest}{returnFare && " (return fare)"}</td>
                    <td className="text-right">{l.bundled ? "included" : gbp(f)}</td>
                  </tr>
                );
              })}
              {req.bags > 0 && (
                <tr><td>Checked bags ({req.bags} each)</td><td className="text-right">{o.costs.bagsUnknown ? "not confirmed" : "included in fares"}</td></tr>
              )}
              {o.costs.excessBaggage > 0 && <tr><td>Likely excess baggage (estimate)</td><td className="text-right">{gbp(o.costs.excessBaggage)}</td></tr>}
              {o.costs.hotel > 0 && <tr><td>Hotel (estimate)</td><td className="text-right">{gbp(o.costs.hotel)}</td></tr>}
              <tr className="font-bold"><td>Total, {travellers(req)}</td><td className="text-right">{gbp(o.costs.total)}</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-slate-500">Price as of {formatLocalTime(o.priceAsOf, UK_TZ)} UK time. Fares change — check before booking.</p>
        </div>
      )}
    </article>
  );
}

function draftKey(originArea: string) {
  return `ground:${originArea}`;
}

/** Start from what the user typed last time on this device, else the admin defaults. */
function initialDrafts(data: SearchResponse, req: SearchRequest): Record<string, GroundDraft> {
  let saved: Record<string, GroundDraft> = {};
  try {
    saved = JSON.parse(localStorage.getItem(draftKey(req.originArea)) ?? "{}");
  } catch {
    /* storage unavailable */
  }
  // Older saved drafts predate some fields (e.g. coach); fill them in.
  const drafts: Record<string, GroundDraft> = Object.fromEntries(Object.entries(saved).map(([a, d]) => [a, { ...EMPTY_DRAFT, ...d }]));
  for (const o of data.options) {
    const g = o.ground;
    if (drafts[o.ukAirport] || g.mode === "not set") continue;
    const perPerson = g.per_person ? g.cost_gbp : null;
    drafts[o.ukAirport] = {
      ...EMPTY_DRAFT,
      ...(g.mode === "train" && perPerson != null ? { trainPerPerson: String(perPerson), trainMins: String(g.duration_mins) } : {}),
      ...(g.mode === "cab" && !g.per_person ? { cabTotal: String(g.cost_gbp), cabMins: String(g.duration_mins) } : {}),
    };
  }
  return drafts;
}

export function Results({ data, req, settings }: { data: SearchResponse; req: SearchRequest; settings: Settings }) {
  const [priceWeight, setPriceWeight] = useState(0.6);
  const pax = req.adults + req.children;
  const airports = useMemo(() => [...new Set(data.options.map((o) => o.ukAirport))].sort(), [data.options]);
  const [drafts, setDrafts] = useState<Record<string, GroundDraft>>({});
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
  const options = useMemo(
    () =>
      data.options.map((o) => {
        const choice = pickGround(toInput(drafts[o.ukAirport] ?? EMPTY_DRAFT), pax);
        return choice ? applyGround(o, choice, settings.uk_airport_arrival_mins, settings.uk_arrival_exit_mins ?? 60) : o;
      }),
    [data.options, drafts, pax, settings.uk_airport_arrival_mins, settings.uk_arrival_exit_mins],
  );
  const ranked = useMemo(() => rankOptions(options, priceWeight, settings), [options, priceWeight, settings]);
  const tz = data.airportTz;
  const s = data.stats;
  const asOf = data.options.map((o) => o.priceAsOf).sort()[0];

  return (
    <section className="space-y-4">
      <div className="rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800">
        <p>
          <strong>{data.options.length}</strong> options · <strong>{s.paidCalls}</strong> Ignav calls used · {s.cacheHits} from cache
          {s.failedCalls > 0 && ` · ${s.failedCalls} failed`} · {(s.durationMs / 1000).toFixed(1)}s
        </p>
        {asOf && <p>Prices as of {formatLocalTime(asOf, UK_TZ)} UK time (cached up to {settings.cache_ttl_mins / 60}h).</p>}
        {data.storage === "memory" && <p className="text-amber-800 dark:text-amber-300">Supabase not connected: cache resets when the server restarts.</p>}
      </div>

      {data.errors.length > 0 && (
        <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-900/30 dark:text-rose-100">
          <p className="font-semibold">Some searches didn&apos;t work:</p>
          <ul className="list-disc pl-5">{data.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {data.notes.length > 0 && (
        <details className="text-sm text-slate-600 dark:text-slate-400">
          <summary>Search notes ({data.notes.length})</summary>
          <ul className="list-disc pl-5">{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </details>
      )}

      {data.options.length > 0 && (
        <>
          <GroundPanel originArea={req.originArea} airports={airports} drafts={drafts} pax={pax} onChange={updateDraft} returnTrip={!!req.returnDate} />

          <div className="grid gap-3">
            {ranked.cheapest && <OptionCard o={ranked.cheapest} tz={tz} req={req} highlight="Cheapest" groundAlts={alts[ranked.cheapest.ukAirport] ?? []} />}
            {ranked.fastest && ranked.fastest !== ranked.cheapest && <OptionCard o={ranked.fastest} tz={tz} req={req} highlight="Fastest" groundAlts={alts[ranked.fastest.ukAirport] ?? []} />}
          </div>

          <div>
            <label htmlFor="weight" className="block text-sm font-medium">
              Best value: {priceWeight >= 0.5 ? `mostly price (${Math.round(priceWeight * 100)}%)` : `mostly time (${Math.round((1 - priceWeight) * 100)}%)`}
            </label>
            <div className="flex items-center gap-2 text-sm">
              <span>Time</span>
              <input id="weight" type="range" min={0} max={1} step={0.05} value={priceWeight} onChange={(e) => setPriceWeight(Number(e.target.value))} className="flex-1" />
              <span>Price</span>
            </div>
          </div>

          <h2 className="text-lg font-semibold">Top 10 by best value</h2>
          <div className="grid gap-3">
            {ranked.top.map((o, i) => <OptionCard key={o.id} o={o} tz={tz} req={req} highlight={i === 0 ? "Best value" : undefined} groundAlts={alts[o.ukAirport] ?? []} />)}
          </div>
        </>
      )}
    </section>
  );
}
