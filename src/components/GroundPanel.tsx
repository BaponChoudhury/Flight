"use client";

import { groundChoices, pickGround, type GroundInput, type GroundMode } from "@/lib/engine/rules";
import { groundLinks, type GroundLink } from "@/lib/ground-links";

/** Raw text the user typed, per UK airport. Kept as strings so inputs can be blank. */
export interface GroundDraft {
  trainPerPerson: string;
  trainMins: string;
  coachPerPerson: string;
  coachMins: string;
  cabTotal: string;
  cabMins: string;
  use: GroundInput["use"];
}

export const EMPTY_DRAFT: GroundDraft = {
  trainPerPerson: "",
  trainMins: "",
  coachPerPerson: "",
  coachMins: "",
  cabTotal: "",
  cabMins: "",
  use: "cheapest",
};

const num = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) || Number(s) < 0 ? null : Number(s));

/** "1:20", "1h20", "80" (minutes) or "1.5" (hours) → minutes. */
export function parseMins(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  const hm = /^(\d+)\s*(?:h|:)\s*(\d{1,2})?\s*m?$/.exec(t);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  const n = Number(t.replace(/m(in)?s?$/, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return t.includes(".") ? Math.round(n * 60) : n;
}

export function toInput(d: GroundDraft): GroundInput {
  return {
    trainPerPerson: num(d.trainPerPerson),
    trainMins: parseMins(d.trainMins),
    coachPerPerson: num(d.coachPerPerson ?? ""),
    coachMins: parseMins(d.coachMins ?? ""),
    cabTotal: num(d.cabTotal),
    cabMins: parseMins(d.cabMins),
    use: d.use,
  };
}

const field = "w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-base dark:border-slate-600 dark:bg-slate-800";
const gbp = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const LABEL: Record<GroundMode, string> = { train: "Train", coach: "Coach", cab: "Cab" };

const ROWS: { mode: GroundMode; icon: string; price: keyof GroundDraft; mins: keyof GroundDraft; pricePlaceholder: string; minsPlaceholder: string }[] = [
  { mode: "train", icon: "🚆", price: "trainPerPerson", mins: "trainMins", pricePlaceholder: "per person", minsPlaceholder: "e.g. 1:20" },
  { mode: "coach", icon: "🚌", price: "coachPerPerson", mins: "coachMins", pricePlaceholder: "per person", minsPlaceholder: "e.g. 2:10" },
  { mode: "cab", icon: "🚕", price: "cabTotal", mins: "cabMins", pricePlaceholder: "whole car", minsPlaceholder: "e.g. 1:05" },
];

function Links({ links }: { links: GroundLink[] }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {links.map((l) => (
        <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-sky-700 underline dark:text-sky-400">
          {l.label} ↗
        </a>
      ))}
    </span>
  );
}

export function GroundPanel({
  originArea,
  airports,
  drafts,
  pax,
  onChange,
  returnTrip = false,
}: {
  originArea: string;
  airports: string[];
  drafts: Record<string, GroundDraft>;
  pax: number;
  onChange: (airport: string, d: GroundDraft) => void;
  returnTrip?: boolean;
}) {
  return (
    <details open className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <summary className="cursor-pointer font-semibold">Getting to the airport from {originArea}</summary>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Tap a link to check the price, then enter it here. Results update straight away — no new search needed. Google Maps links open with your
        journey filled in; the rail and coach sites open their search page. Times can be minutes (80) or hours (1:20).
        {returnTrip && " Enter one-way prices — we count them twice for the return."}
      </p>
      <div className="mt-3 space-y-4">
        {airports.map((a) => {
          const d = { ...EMPTY_DRAFT, ...drafts[a] };
          const set = (patch: Partial<GroundDraft>) => onChange(a, { ...d, ...patch });
          const input = toInput(d);
          const chosen = pickGround(input, pax);
          const options = groundChoices(input, pax);
          const links = groundLinks(originArea, a);
          return (
            <fieldset key={a} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <legend className="px-1 font-semibold">{originArea} → {a}</legend>
              <div className="grid grid-cols-[4rem_1fr_1fr] items-center gap-x-2 gap-y-1 text-sm">
                <span />
                <span className="font-medium">Price £</span>
                <span className="font-medium">Time</span>
                {ROWS.map((r) => (
                  <div key={r.mode} className="contents">
                    <span>{r.icon} {LABEL[r.mode]}</span>
                    <input
                      aria-label={`${LABEL[r.mode]} price to ${a}`}
                      inputMode="decimal"
                      placeholder={r.pricePlaceholder}
                      className={field}
                      value={d[r.price]}
                      onChange={(e) => set({ [r.price]: e.target.value })}
                    />
                    <input
                      aria-label={`${LABEL[r.mode]} journey time to ${a}`}
                      placeholder={r.minsPlaceholder}
                      className={field}
                      value={d[r.mins]}
                      onChange={(e) => set({ [r.mins]: e.target.value })}
                    />
                    <span />
                    <span className="col-span-2 pb-1">
                      <Links links={links[r.mode]} />
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <label className="flex items-center gap-1">
                  Use
                  <select
                    className="rounded border border-slate-300 bg-white px-1 py-1 dark:border-slate-600 dark:bg-slate-800"
                    value={d.use}
                    onChange={(e) => set({ use: e.target.value as GroundDraft["use"] })}
                  >
                    <option value="cheapest">cheapest</option>
                    <option value="train">train</option>
                    <option value="coach">coach</option>
                    <option value="cab">cab</option>
                  </select>
                </label>
                <span className="text-slate-600 dark:text-slate-400">
                  {options.length === 0
                    ? "Not entered yet — results use £0 and no travel time for this airport."
                    : options.map((o) => `${LABEL[o.mode]} ${gbp(o.costGbp)} for ${pax}`).join(" · ") +
                      (chosen ? ` → using ${LABEL[chosen.mode].toLowerCase()}` : ` → no ${d.use} price entered`)}
                </span>
              </div>
            </fieldset>
          );
        })}
      </div>
    </details>
  );
}
