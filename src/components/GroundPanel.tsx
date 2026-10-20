"use client";

import { groundChoices, pickGround, type GroundInput } from "@/lib/engine/rules";

/** Raw text the user typed, per UK airport. Kept as strings so inputs can be blank. */
export interface GroundDraft {
  trainPerPerson: string;
  trainMins: string;
  cabTotal: string;
  cabMins: string;
  use: GroundInput["use"];
}

export const EMPTY_DRAFT: GroundDraft = { trainPerPerson: "", trainMins: "", cabTotal: "", cabMins: "", use: "cheapest" };

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
  return { trainPerPerson: num(d.trainPerPerson), trainMins: parseMins(d.trainMins), cabTotal: num(d.cabTotal), cabMins: parseMins(d.cabMins), use: d.use };
}

const field = "w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-base dark:border-slate-600 dark:bg-slate-800";
const gbp = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

export function GroundPanel({
  originArea,
  airports,
  drafts,
  pax,
  onChange,
}: {
  originArea: string;
  airports: string[];
  drafts: Record<string, GroundDraft>;
  pax: number;
  onChange: (airport: string, d: GroundDraft) => void;
}) {
  return (
    <details open className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <summary className="cursor-pointer font-semibold">Getting to the airport from {originArea}</summary>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Look up your train fare (e.g. on National Rail) and a cab quote, and enter them here. Results update straight away — no new search needed.
        Times can be minutes (80) or hours (1:20).
      </p>
      <div className="mt-3 space-y-4">
        {airports.map((a) => {
          const d = drafts[a] ?? EMPTY_DRAFT;
          const set = (patch: Partial<GroundDraft>) => onChange(a, { ...d, ...patch });
          const input = toInput(d);
          const chosen = pickGround(input, pax);
          const options = groundChoices(input, pax);
          return (
            <fieldset key={a} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <legend className="px-1 font-semibold">{originArea} → {a}</legend>
              <div className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2 text-sm">
                <span />
                <span className="font-medium">Price £</span>
                <span className="font-medium">Time</span>
                <span>🚆 Train</span>
                <input aria-label={`Train fare per person to ${a}`} inputMode="decimal" placeholder="per person" className={field} value={d.trainPerPerson} onChange={(e) => set({ trainPerPerson: e.target.value })} />
                <input aria-label={`Train journey time to ${a}`} placeholder="e.g. 1:20" className={field} value={d.trainMins} onChange={(e) => set({ trainMins: e.target.value })} />
                <span>🚕 Cab</span>
                <input aria-label={`Cab price to ${a}`} inputMode="decimal" placeholder="whole car" className={field} value={d.cabTotal} onChange={(e) => set({ cabTotal: e.target.value })} />
                <input aria-label={`Cab journey time to ${a}`} placeholder="e.g. 1:05" className={field} value={d.cabMins} onChange={(e) => set({ cabMins: e.target.value })} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <label className="flex items-center gap-1">
                  Use
                  <select className="rounded border border-slate-300 bg-white px-1 py-1 dark:border-slate-600 dark:bg-slate-800" value={d.use} onChange={(e) => set({ use: e.target.value as GroundDraft["use"] })}>
                    <option value="cheapest">cheaper</option>
                    <option value="train">train</option>
                    <option value="cab">cab</option>
                  </select>
                </label>
                <span className="text-slate-600 dark:text-slate-400">
                  {options.length === 0
                    ? "Not entered yet — results use £0 and no travel time for this airport."
                    : options.map((o) => `${o.mode === "train" ? "Train" : "Cab"} ${gbp(o.costGbp)} for ${pax}`).join(" · ") +
                      (chosen ? ` → using ${chosen.mode}` : ` → no ${d.use} price entered`)}
                </span>
              </div>
            </fieldset>
          );
        })}
      </div>
    </details>
  );
}
