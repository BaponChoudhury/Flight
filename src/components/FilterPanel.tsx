"use client";

import { formatDuration } from "@/lib/engine/time";
import { NO_FILTERS, TIME_OF_DAY, type Facet, type Facets, type Filters, type TicketType, type TimeOfDay } from "@/lib/filters";

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const box = "h-4 w-4 shrink-0";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-slate-100 pt-4 dark:border-slate-800">
      <legend className="mb-2 text-sm font-bold">{title}</legend>
      <div className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">{children}</div>
    </fieldset>
  );
}

function Check({ checked, onChange, children, right }: { checked: boolean; onChange: (on: boolean) => void; children: React.ReactNode; right?: string }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" className={box} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex-1">{children}</span>
      {right && <span className="text-xs text-slate-500 dark:text-slate-400">{right}</span>}
    </label>
  );
}

const toggle = <T,>(list: T[], item: T, on: boolean) => (on ? [...list, item] : list.filter((x) => x !== item));

/** Ticked = shown. Unticking hides every option that uses it. */
function ShowList({ facets, hidden, onChange, limit = 8 }: { facets: Facet[]; hidden: string[]; onChange: (hidden: string[]) => void; limit?: number }) {
  const rows = (list: Facet[]) =>
    list.map((f) => (
      <Check key={f.code} checked={!hidden.includes(f.code)} onChange={(on) => onChange(toggle(hidden, f.code, !on))} right={`from ${gbp(f.fromGbp)}`}>
        {f.label}
      </Check>
    ));
  return (
    <>
      {facets.length > 1 && (
        <div className="flex gap-3 text-xs">
          <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => onChange([])}>All</button>
          <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => onChange(facets.map((f) => f.code))}>None</button>
        </div>
      )}
      {rows(facets.slice(0, limit))}
      {facets.length > limit && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-brand-600 dark:text-brand-300">{facets.length - limit} more</summary>
          <div className="mt-1 space-y-1">{rows(facets.slice(limit))}</div>
        </details>
      )}
    </>
  );
}

export function FilterPanel({
  filters,
  facets,
  onChange,
  shownCount,
  totalCount,
}: {
  filters: Filters;
  facets: Facets;
  onChange: (f: Filters) => void;
  shownCount: number;
  totalCount: number;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const times = (key: "departTimes" | "arriveTimes") =>
    TIME_OF_DAY.map((t) => (
      <Check key={t.id} checked={filters[key].includes(t.id)} onChange={(on) => set({ [key]: toggle<TimeOfDay>(filters[key], t.id, on) })}>
        {t.label}
      </Check>
    ));
  const maxPrice = filters.maxPrice ?? facets.price.max;
  const maxMins = filters.maxMins ?? facets.mins.max;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm">
          Showing <strong>{shownCount}</strong> of {totalCount}
        </p>
        <button type="button" className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => onChange(NO_FILTERS)}>
          Reset filters
        </button>
      </div>

      <Section title="Cancellation">
        <Check checked={filters.refundableOnly} onChange={(on) => set({ refundableOnly: on })}>
          Refundable tickets only
        </Check>
        <p className="text-xs text-slate-500 dark:text-slate-400">Money back if you cancel before departure (a fee may apply). Refund rules come from Aviasales only.</p>
      </Section>

      {facets.hasOne && facets.hasSeparate && (
        <Section title="Tickets">
          {(
            [
              ["one", "One ticket (protected connections)"],
              ["separate", "Separate tickets (cheaper, you change yourself)"],
            ] as [TicketType, string][]
          ).map(([id, label]) => (
            <Check key={id} checked={filters.ticketTypes.includes(id)} onChange={(on) => set({ ticketTypes: toggle(filters.ticketTypes, id, on) })}>
              {label}
            </Check>
          ))}
        </Section>
      )}

      {facets.stops.length > 1 && (
        <Section title="Stops on the way out">
          {[null, ...facets.stops.slice(0, -1)].map((n) => (
            <label key={String(n)} className="flex items-center gap-2">
              <input type="radio" name="stops" className={box} checked={filters.maxStops === n} onChange={() => set({ maxStops: n })} />
              {n == null ? "Any" : n === 0 ? "Direct only" : `Up to ${n} stop${n === 1 ? "" : "s"}`}
            </label>
          ))}
        </Section>
      )}

      {facets.price.max > facets.price.min && (
        <Section title="Price">
          <label className="block">
            Up to <strong>{gbp(maxPrice)}</strong>
            <input
              type="range"
              className="w-full"
              min={facets.price.min}
              max={facets.price.max}
              step={10}
              value={maxPrice}
              onChange={(e) => set({ maxPrice: Number(e.target.value) >= facets.price.max ? null : Number(e.target.value) })}
            />
          </label>
        </Section>
      )}

      {facets.mins.max > facets.mins.min && (
        <Section title="Journey time">
          <label className="block">
            Up to <strong>{formatDuration(maxMins)}</strong>
            <input
              type="range"
              className="w-full"
              min={facets.mins.min}
              max={facets.mins.max}
              step={15}
              value={maxMins}
              onChange={(e) => set({ maxMins: Number(e.target.value) >= facets.mins.max ? null : Number(e.target.value) })}
            />
          </label>
        </Section>
      )}

      <Section title="Leave the UK">{times("departTimes")}</Section>
      <Section title="Arrive in India">{times("arriveTimes")}</Section>

      {facets.ukAirports.length > 1 && (
        <Section title="UK airport">
          <ShowList facets={facets.ukAirports} hidden={filters.hiddenUkAirports} onChange={(h) => set({ hiddenUkAirports: h })} />
        </Section>
      )}

      {facets.airlines.length > 1 && (
        <Section title="Airlines">
          <ShowList facets={facets.airlines} hidden={filters.hiddenAirlines} onChange={(h) => set({ hiddenAirlines: h })} />
        </Section>
      )}

      {facets.via.length > 0 && (
        <Section title="Connecting airports">
          <ShowList facets={facets.via} hidden={filters.hiddenVia} onChange={(h) => set({ hiddenVia: h })} />
        </Section>
      )}

      <Section title="More">
        <Check checked={filters.bagsConfirmed} onChange={(on) => set({ bagsConfirmed: on })}>Bag price confirmed</Check>
        <Check checked={filters.noExcessBaggage} onChange={(on) => set({ noExcessBaggage: on })}>No excess baggage risk</Check>
        <Check checked={filters.noTerminalChange} onChange={(on) => set({ noTerminalChange: on })}>No terminal change</Check>
        <Check checked={filters.noOvernight} onChange={(on) => set({ noOvernight: on })}>No overnight stop</Check>
      </Section>
    </div>
  );
}
