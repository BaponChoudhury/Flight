"use client";

import { groundChoices, pickGround, type GroundInput, type GroundMode } from "@/lib/engine/rules";
import { groundLinks, type GroundLink } from "@/lib/ground-links";
import { Icon } from "./ui";

/** Raw text the user typed, per UK airport. Kept as strings so inputs can be blank. */
export interface GroundDraft {
  trainPerPerson: string;
  coachPerPerson: string;
  cabTotal: string;
  use: GroundInput["use"];
}

export const EMPTY_DRAFT: GroundDraft = {
  trainPerPerson: "",
  coachPerPerson: "",
  cabTotal: "",
  use: "cheapest",
};

const num = (s: string | undefined) => (!s || s.trim() === "" || !Number.isFinite(Number(s)) || Number(s) < 0 ? null : Number(s));

export function toInput(d: GroundDraft): GroundInput {
  return { trainPerPerson: num(d.trainPerPerson), coachPerPerson: num(d.coachPerPerson), cabTotal: num(d.cabTotal), use: d.use };
}

const field = "w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-slate-600 dark:bg-slate-800";
const gbp = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const LABEL: Record<GroundMode, string> = { train: "Train", coach: "Coach", cab: "Cab" };

const COLUMNS: { mode: GroundMode; icon: string; price: "trainPerPerson" | "coachPerPerson" | "cabTotal"; per: string }[] = [
  { mode: "train", icon: "🚆", price: "trainPerPerson", per: "per person" },
  { mode: "coach", icon: "🚌", price: "coachPerPerson", per: "per person" },
  { mode: "cab", icon: "🚕", price: "cabTotal", per: "whole car" },
];

function Links({ links }: { links: GroundLink[] }) {
  return (
    <span className="flex flex-col gap-0.5">
      {links.map((l) => (
        <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">
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
  const th = "px-1.5 py-1.5 text-left align-bottom font-medium";
  const added = airports.filter((a) => groundChoices(toInput({ ...EMPTY_DRAFT, ...drafts[a] }), pax).length > 0);
  return (
    <details className="group rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
          <Icon name="train" className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Getting to the airport{originArea ? ` from ${originArea}` : ""}</span>
          <span className="block text-sm text-slate-600 dark:text-slate-400">
            {added.length
              ? `Added for ${added.join(", ")} — included in the prices below`
              : "Add your train, coach or cab fare to see the full trip cost"}
          </span>
        </span>
        <Icon name="chevronDown" className="h-5 w-5 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-100 p-4 pt-3 dark:border-slate-800">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Tap a link to check the price, then enter it here. Results update straight away — no new search needed.
        {returnTrip && " Enter one-way prices — we count them twice for the return."}
      </p>
      <table className="mt-3 w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            <th className={`${th} w-[26%]`}>Airport</th>
            {COLUMNS.map((c) => (
              <th key={c.mode} className={th}>
                {c.icon} {LABEL[c.mode]}
                <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">£ {c.per}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {airports.map((a) => {
            const d = { ...EMPTY_DRAFT, ...drafts[a] };
            const set = (patch: Partial<GroundDraft>) => onChange(a, { ...d, ...patch });
            const input = toInput(d);
            const chosen = pickGround(input, pax);
            const entered = groundChoices(input, pax).length > 0;
            const links = groundLinks(originArea, a);
            return (
              <tr key={a} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800">
                <td className="px-1.5 py-2">
                  <p className="font-semibold">{a}</p>
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Use</span>
                  <select
                    aria-label={`Which to use for ${a}`}
                    className="w-full rounded border border-slate-300 bg-white px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
                    value={d.use}
                    onChange={(e) => set({ use: e.target.value as GroundDraft["use"] })}
                  >
                    <option value="cheapest">Cheapest</option>
                    <option value="train">Train</option>
                    <option value="coach">Coach</option>
                    <option value="cab">Cab</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {!entered ? "Not entered — £0" : chosen ? `${LABEL[chosen.mode]}: ${gbp(chosen.costGbp)} for ${pax}` : `No ${d.use} price`}
                  </p>
                </td>
                {COLUMNS.map((c) => (
                  <td key={c.mode} className="px-1.5 py-2">
                    <input
                      aria-label={`${LABEL[c.mode]} price to ${a}`}
                      inputMode="decimal"
                      placeholder="£"
                      className={field}
                      value={d[c.price]}
                      onChange={(e) => set({ [c.price]: e.target.value })}
                    />
                    <div className="mt-1">
                      <Links links={links[c.mode]} />
                    </div>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </details>
  );
}
