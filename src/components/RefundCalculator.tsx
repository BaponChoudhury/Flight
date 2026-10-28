"use client";

import { useMemo, useState } from "react";
import { estimateRefund, SELLERS, SOURCES, type Cabin, type RefundEstimate, type RefundInput, type Scenario, type TicketType } from "@/lib/refunds";
import { card, Icon, type IconName } from "./ui";

const gbp = (n: number) => `£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const field = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-800";
const label = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";

function Cards<T extends string>({ value, onChange, options, name }: { value: T; onChange: (v: T) => void; options: [T, string, string, IconName][]; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2 sm:grid-cols-3">
      {options.map(([v, title, sub, icon]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${value === v ? "border-brand-500 bg-brand-50 ring-4 ring-brand-500/15 dark:bg-brand-900/30" : "border-slate-300 hover:border-slate-400 dark:border-slate-700"}`}
        >
          <Icon name={icon} className={`mt-0.5 h-5 w-5 shrink-0 ${value === v ? "text-brand-600" : "text-slate-400"}`} />
          <span>
            <span className="block text-sm font-semibold">{title}</span>
            <span className="block text-xs text-slate-500">{sub}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

const num = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Math.max(0, Number(s)));
const int = (s: string | undefined, d: number) => (s && /^\d+$/.test(s) ? Math.min(9, Number(s)) : d);

/** A ready-to-send email for the traveller to copy. */
function letter(i: RefundInput, e: RefundEstimate): string {
  const ask =
    i.scenario === "airline_cancelled"
      ? `My flight was cancelled by the airline. Under UK261 I'm entitled to a full refund of ${gbp(i.pricePaidGbp)} to my original payment method within 7 days. I don't accept a voucher.`
      : i.ticket === "refundable"
        ? `I'd like to cancel this refundable booking and receive the refund due under the fare rules, to my original payment method.`
        : `I won't be using this booking${i.scenario === "missed" ? " (I missed the flight)" : ""}. Please refund the unused taxes and charges, including UK Air Passenger Duty, which is only payable when a passenger flies.`;
  return [
    "Subject: Refund request, booking reference [YOUR REFERENCE]",
    "",
    "Hello,",
    "",
    "I'm writing about booking [YOUR REFERENCE] for [PASSENGER NAMES], flight [FLIGHT NUMBER] on [DATE].",
    "",
    ask,
    // When the airline cancels, ask for the full amount; never offer a figure net of fees.
    i.scenario !== "airline_cancelled" && e.total > 0 ? `By my calculation the amount due is about ${gbp(e.total)}.` : "",
    "",
    "Please confirm the amount and when it will be paid.",
    "",
    "Thank you,",
    "[YOUR NAME]",
  ]
    .filter((l, n, a) => !(l === "" && a[n - 1] === ""))
    .join("\n");
}

export function RefundCalculator({ initial, email }: { initial: Record<string, string | undefined>; email: string }) {
  const [scenario, setScenario] = useState<Scenario>("i_cancel");
  const [ticket, setTicket] = useState<TicketType>((["refundable", "non_refundable", "unknown"] as const).find((t) => t === initial.ticket) ?? "non_refundable");
  const [price, setPrice] = useState(initial.price ?? "");
  const [fee, setFee] = useState(initial.fee ?? "");
  const [taxes, setTaxes] = useState("");
  const [seller, setSeller] = useState(SELLERS.some((s) => s.id === initial.seller) ? initial.seller! : "airline");
  const [adults, setAdults] = useState(int(initial.adults, 1));
  const [children, setChildren] = useState(int(initial.children, 0));
  const [infants, setInfants] = useState(int(initial.infants, 0));
  const [cabin, setCabin] = useState<Cabin>("economy");
  const [date, setDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(initial.date ?? "") ? initial.date! : "");
  const [leavesUk, setLeavesUk] = useState(true);
  const [notice, setNotice] = useState("3");
  const [ukRules, setUkRules] = useState(true);
  const [copied, setCopied] = useState(false);

  const input: RefundInput = {
    scenario, ticket, pricePaidGbp: num(price) ?? 0, refundFeeGbp: num(fee), otherTaxesGbp: num(taxes),
    adults, children, infants, cabin, ukDepartureDate: leavesUk ? date || new Date().toISOString().slice(0, 10) : null,
    sellerId: seller, noticeDays: num(notice), ukRulesApply: ukRules,
  };
  const e = useMemo(() => estimateRefund(input), [JSON.stringify(input)]); // eslint-disable-line react-hooks/exhaustive-deps
  const needPrice = scenario === "airline_cancelled" || ticket === "refundable";
  const text = letter(input, e);

  const stepper = (lbl: string, v: number, set: (n: number) => void, min = 0) => (
    <div>
      <span className={label}>{lbl}</span>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`Fewer ${lbl}`} className="h-9 w-9 rounded-full border border-slate-300 disabled:opacity-30 dark:border-slate-600" disabled={v <= min} onClick={() => set(v - 1)}>−</button>
        <span className="tabular w-5 text-center font-semibold">{v}</span>
        <button type="button" aria-label={`More ${lbl}`} className="h-9 w-9 rounded-full border border-slate-300 disabled:opacity-30 dark:border-slate-600" disabled={v >= 9} onClick={() => set(v + 1)}>+</button>
      </div>
    </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className={`${card} space-y-5 p-5 sm:p-6`}>
        <div>
          <span className={label}>What happened?</span>
          <Cards
            name="What happened"
            value={scenario}
            onChange={setScenario}
            options={[
              ["i_cancel", "I'm cancelling", "I don't want to fly", "x"],
              ["missed", "I missed it", "The flight left without me", "clock"],
              ["airline_cancelled", "Airline cancelled", "Or moved it a lot", "alert"],
            ]}
          />
        </div>

        {scenario !== "airline_cancelled" && (
          <div>
            <span className={label}>Your ticket</span>
            <Cards
              name="Ticket type"
              value={ticket}
              onChange={setTicket}
              options={[
                ["refundable", "Refundable", "Money back, minus a fee", "refund"],
                ["non_refundable", "Non-refundable", "Most cheap fares", "x"],
                ["unknown", "Not sure", "We'll show the minimum", "info"],
              ]}
            />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Total price paid (£){!needPrice && " (optional)"}</span>
            <input inputMode="decimal" className={field} value={price} onChange={(ev) => setPrice(ev.target.value)} placeholder="e.g. 640" />
          </label>
          {scenario !== "airline_cancelled" && ticket === "refundable" && (
            <label className="block">
              <span className={label}>Refund fee in the fare rules (£)</span>
              <input inputMode="decimal" className={field} value={fee} onChange={(ev) => setFee(ev.target.value)} placeholder="e.g. 150" />
            </label>
          )}
          {scenario !== "airline_cancelled" && ticket !== "refundable" && (
            <label className="block">
              <span className={label}>Other taxes on your receipt (£, optional)</span>
              <input inputMode="decimal" className={field} value={taxes} onChange={(ev) => setTaxes(ev.target.value)} placeholder="Not fuel surcharges (YQ/YR)" />
            </label>
          )}
          <label className="block">
            <span className={label}>Booked with</span>
            <select className={field} value={seller} onChange={(ev) => setSeller(ev.target.value)}>
              {SELLERS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={label}>Cabin</span>
            <select className={field} value={cabin} onChange={(ev) => setCabin(ev.target.value as Cabin)}>
              <option value="economy">Economy</option>
              <option value="premium">Premium economy, business or first</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-6">
          {stepper("Adults", adults, setAdults, 1)}
          {stepper("Children 2–15", children, setChildren)}
          {stepper("Infants under 2", infants, setInfants)}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Date of the flight leaving the UK</span>
            <input type="date" className={field} value={date} disabled={!leavesUk} onChange={(ev) => setDate(ev.target.value)} />
          </label>
          <label className="flex items-center gap-2 self-end pb-3 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={!leavesUk} onChange={(ev) => setLeavesUk(!ev.target.checked)} />
            This ticket doesn&apos;t leave from the UK
          </label>
          {scenario === "airline_cancelled" && (
            <>
              <label className="block">
                <span className={label}>Days&apos; notice the airline gave</span>
                <input inputMode="numeric" className={field} value={notice} onChange={(ev) => setNotice(ev.target.value)} />
              </label>
              <label className="flex items-start gap-2 self-end pb-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={ukRules} onChange={(ev) => setUkRules(ev.target.checked)} />
                The flight left the UK, or was on a UK or EU airline
              </label>
            </>
          )}
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4">
        <div className="overflow-hidden rounded-2xl bg-brand-950 text-white shadow-xl">
          <div className="p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-300">You could get back</p>
            <p className="tabular mt-1 font-display text-5xl font-medium">{gbp(e.total)}</p>
            {e.extras.map((x) => (
              <p key={x.label} className="mt-2 rounded-lg bg-white/10 px-3 py-2 text-sm">
                <strong>+ {gbp(x.gbp)}</strong> {x.label.toLowerCase()}
              </p>
            ))}
          </div>
          <table className="w-full bg-white/5 text-sm">
            <tbody>
              {e.lines.map((l) => (
                <tr key={l.label} className="border-t border-white/10 align-top">
                  <td className="px-5 py-2">
                    {l.label}
                    {l.note && <span className="block text-xs text-white/60">{l.note}</span>}
                  </td>
                  <td className={`tabular whitespace-nowrap px-5 py-2 text-right ${l.gbp < 0 ? "text-rose-300" : ""}`}>{l.gbp < 0 ? "−" : ""}{gbp(l.gbp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {e.unknowns.length > 0 && (
          <div className={`${card} p-4 text-sm`}>
            <h3 className="font-bold">Good to know</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-400">{e.unknowns.map((u) => <li key={u}>{u}</li>)}</ul>
          </div>
        )}

        <div className={`${card} p-4 text-sm`}>
          <h3 className="font-bold">How to claim</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-400">{e.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          {e.extras.length > 0 && (
            <a href="/claim" className="mt-3 inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline dark:text-brand-300">
              Check compensation with Compensair <Icon name="arrowRight" className="h-3.5 w-3.5" strokeWidth={2.4} />
            </a>
          )}
        </div>

        <div className={`${card} p-4 text-sm`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold">Email to send</h3>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
              className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-300">{text}</pre>
        </div>

        <details className="px-1 text-xs text-slate-500">
          <summary className="cursor-pointer">Where these figures come from</summary>
          <ul className="mt-2 space-y-1">
            {SOURCES.map((s) => (
              <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">{s.label}</a></li>
            ))}
          </ul>
          <p className="mt-2">An estimate, not legal advice. Signed in as {email}.</p>
        </details>
      </aside>
    </div>
  );
}
