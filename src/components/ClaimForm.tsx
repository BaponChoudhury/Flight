"use client";

import { useState } from "react";
import type { ArrivalDelay, Disruption } from "@/lib/compensair";
import { AirportPicker } from "./AirportPicker";
import { card, Icon, type IconName } from "./ui";

const box =
  "flex min-h-[3.5rem] items-center gap-2.5 rounded-xl border border-slate-300 bg-white px-3 transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-800/60";
const boxLabel = "block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const bare = "w-full bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400 dark:text-white";

function Field({ label, htmlFor, icon, children, hint }: { label: string; htmlFor: string; icon?: IconName; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className={box}>
        {icon && <Icon name={icon} className="h-5 w-5 shrink-0 text-slate-400" />}
        <div className="min-w-0 flex-1 py-2">
          <label htmlFor={htmlFor} className={boxLabel}>{label}</label>
          {children}
        </div>
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Choice<T extends string>({ name, value, options, onChange }: { name: string; value: T | null; options: [T, string, string?][]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2 sm:grid-cols-3">
      {options.map(([v, label, sub]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded-xl border px-3 py-2.5 text-left transition ${value === v ? "border-brand-500 bg-brand-50 ring-4 ring-brand-500/15 dark:bg-brand-900/30" : "border-slate-300 hover:border-slate-400 dark:border-slate-700"}`}
        >
          <span className="block text-sm font-semibold">{label}</span>
          {sub && <span className="block text-xs text-slate-500">{sub}</span>}
        </button>
      ))}
    </div>
  );
}

export function ClaimForm() {
  const [disruption, setDisruption] = useState<Disruption | null>(null);
  const [arrivalDelay, setArrivalDelay] = useState<ArrivalDelay | null>(null);
  const [departure, setDeparture] = useState<string | null>(null);
  const [arrival, setArrival] = useState<string | null>(null);
  const [form, setForm] = useState({ date: "", flightNumber: "", booking: "", name: "", email: "", phone: "", description: "" });
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const today = new Date().toISOString().slice(0, 10);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!disruption) return setError("Choose what happened to your flight.");
    if (!arrivalDelay) return setError("Choose how late you arrived at your final destination.");
    if (!departure || !arrival) return setError("Pick the departure and arrival airports from the suggestions.");
    if (!consent) return setError("Please agree to send your details to Compensair.");
    setStatus("sending");
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, disruption, arrivalDelay, departure, arrival, consent }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Something went wrong. Please try again.");
        setStatus("idle");
        return;
      }
      setReference(d.compensairId ?? d.reference);
      setStatus("sent");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setStatus("idle");
    }
  }

  if (status === "sent")
    return (
      <div className={`${card} p-6 text-center sm:p-10`}>
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <Icon name="check" className="h-6 w-6" strokeWidth={2.4} />
        </span>
        <h2 className="mt-3 text-xl font-bold">Your claim has been sent to Compensair</h2>
        <p className="mx-auto mt-1 max-w-md text-slate-600 dark:text-slate-400">
          Compensair will email you at <strong>{form.email}</strong> about next steps and may ask for a few more details, such as your address or a copy of
          your boarding pass.
        </p>
        <p className="mt-3 text-sm text-slate-500">
          Reference: <span className="font-mono">{reference}</span>
        </p>
      </div>
    );

  return (
    <form onSubmit={submit} className={`${card} space-y-6 p-4 sm:p-6`}>
      <section className="space-y-3">
        <h2 className="text-base font-bold">1. What happened?</h2>
        <Choice
          name="What happened"
          value={disruption}
          onChange={setDisruption}
          options={[
            ["delay", "Delayed", "Arrived late"],
            ["cancellation", "Cancelled", "Flight didn't operate"],
            ["denied_boarding", "Denied boarding", "Overbooked or refused"],
          ]}
        />
        <p className="text-sm font-semibold">How late did you arrive at your final destination?</p>
        <div role="radiogroup" aria-label="How late you arrived" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["under2", "Under 2 hours"],
              ["2to3", "2–3 hours"],
              ["3to4", "3–4 hours"],
              ["over4", "Over 4 hours"],
            ] as [ArrivalDelay, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={arrivalDelay === v}
              onClick={() => setArrivalDelay(v)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${arrivalDelay === v ? "border-brand-500 bg-brand-50 ring-4 ring-brand-500/15 dark:bg-brand-900/30" : "border-slate-300 hover:border-slate-400 dark:border-slate-700"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold">2. Your flight</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="From" htmlFor="c-from" icon="takeoff">
            <AirportPicker id="c-from" inputClassName={bare} placeholder="Departure airport" onChange={setDeparture} />
          </Field>
          <Field label="To" htmlFor="c-to" icon="landing">
            <AirportPicker id="c-to" inputClassName={bare} placeholder="Arrival airport" onChange={setArrival} />
          </Field>
          <Field label="Flight date" htmlFor="c-date" icon="calendar">
            <input id="c-date" type="date" className={bare} max={today} required value={form.date} onChange={set("date")} />
          </Field>
          <Field label="Flight number" htmlFor="c-flight" icon="plane" hint="The flight that was disrupted, as on your ticket.">
            <input id="c-flight" className={bare} placeholder="e.g. AI162" required value={form.flightNumber} onChange={set("flightNumber")} autoComplete="off" />
          </Field>
          <Field label="Booking reference" htmlFor="c-booking" icon="bag" hint="The airline's 6-character code, or your travel agent's order number.">
            <input id="c-booking" className={bare} placeholder="e.g. 2G5HF1" required value={form.booking} onChange={set("booking")} autoComplete="off" />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold">3. Your details</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Full name" htmlFor="c-name" icon="user">
            <input id="c-name" className={bare} placeholder="As on your ticket" required value={form.name} onChange={set("name")} autoComplete="name" />
          </Field>
          <Field label="Email" htmlFor="c-email">
            <input id="c-email" type="email" className={bare} placeholder="you@example.com" required value={form.email} onChange={set("email")} autoComplete="email" />
          </Field>
          <Field label="Phone (optional)" htmlFor="c-phone">
            <input id="c-phone" type="tel" className={bare} placeholder="+44 7700 900123" value={form.phone} onChange={set("phone")} autoComplete="tel" />
          </Field>
        </div>
        <div>
          <label htmlFor="c-desc" className="mb-1 block text-sm font-semibold">What happened? (optional)</label>
          <textarea
            id="c-desc"
            rows={3}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-800/60"
            placeholder="e.g. The flight left 5 hours late and the airline gave no reason."
            value={form.description}
            onChange={set("description")}
          />
        </div>
      </section>

      <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          I agree to send these details to Compensair, who will handle my claim. Compensair&apos;s{" "}
          <a href="https://www.compensair.com/documents/Compensair/en/TermsConditions_Compensair_en.pdf" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 underline dark:text-brand-300">
            terms
          </a>{" "}
          apply, including their fee if the claim succeeds. We don&apos;t keep a copy of your details.
        </span>
      </label>

      {error && (
        <p role="alert" className="flex items-center gap-2 text-sm font-medium text-rose-700 dark:text-rose-300">
          <Icon name="alert" className="h-4 w-4" /> {error}
        </p>
      )}
      <button
        type="submit"
        disabled={status === "sending"}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-brand-600/25 hover:bg-brand-700 disabled:opacity-60"
      >
        {status === "sending" ? "Sending your claim…" : "Send my claim"}
      </button>
    </form>
  );
}
