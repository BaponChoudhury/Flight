"use client";

import { formatDuration } from "@/lib/engine/time";
import { UK_AIRPORTS } from "@/lib/config/places";
import type { RouteOption } from "@/lib/types";
import { card, Icon } from "./ui";

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const nameOf = (code: string) => UK_AIRPORTS.find((a) => a.code === code)?.name ?? code;

/**
 * One card per departure airport: its cheapest trip (including getting there, once the
 * user has added it), its fastest trip and how many options it has. Tapping a card shows
 * only that airport's results. Uses the results already loaded, so no extra searches.
 */
export function AirportCompare({
  options,
  focused,
  onFocus,
}: {
  options: RouteOption[];
  focused: string | null;
  onFocus: (airport: string | null) => void;
}) {
  const groups = new Map<string, RouteOption[]>();
  for (const o of options) groups.set(o.ukAirport, [...(groups.get(o.ukAirport) ?? []), o]);
  if (groups.size < 2) return null;
  const rows = [...groups.entries()].map(([code, list]) => {
    const cheapest = list.reduce((a, b) => (b.costs.total < a.costs.total ? b : a));
    const fastest = list.reduce((a, b) => (b.totalMins < a.totalMins ? b : a));
    return { code, list, cheapest, fastest, groundAdded: cheapest.ground.mode !== "not set" };
  });
  rows.sort((a, b) => a.cheapest.costs.total - b.cheapest.costs.total);
  const best = rows[0];
  const anyGround = rows.some((r) => r.groundAdded);

  return (
    <section aria-label="Compare your airports" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-base font-bold">Compare your airports</h2>
        <p className="text-xs text-slate-500">{anyGround ? "Door to door: totals include getting to each airport" : "Flights only — add your travel to each airport above"}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const on = focused === r.code;
          const extra = r.cheapest.costs.total - best.cheapest.costs.total;
          return (
            <button
              key={r.code}
              type="button"
              aria-pressed={on}
              onClick={() => onFocus(on ? null : r.code)}
              className={`${card} p-4 text-left transition hover:shadow-md ${on ? "ring-2 ring-brand-500" : ""}`}
            >
              <p className="flex items-center gap-1.5 font-semibold">
                <Icon name="takeoff" className="h-4 w-4 shrink-0 text-slate-400" />
                {nameOf(r.code)} <span className="text-xs font-normal text-slate-500">{r.code}</span>
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="tabular text-2xl font-extrabold tracking-tight">
                  {gbp(r.cheapest.costs.total)}
                  {r !== best && <span className="ml-2 text-sm font-semibold text-rose-600">+{gbp(extra)}</span>}
                </p>
                {r === best && (
                  <span className="shrink-0 rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Cheapest</span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {r.groundAdded ? `incl. ${r.cheapest.ground.estimated ? "~" : ""}${gbp(r.cheapest.costs.ground)} to get there` : "flights only"} · {formatDuration(r.cheapest.totalMins)}
              </p>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                Fastest {formatDuration(r.fastest.totalMins)} for {gbp(r.fastest.costs.total)} · {r.list.length} option{r.list.length === 1 ? "" : "s"}
              </p>
              <p className="mt-2 text-xs font-semibold text-brand-600 dark:text-brand-300">{on ? "Showing only this airport · show all" : "Show only this airport"}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
