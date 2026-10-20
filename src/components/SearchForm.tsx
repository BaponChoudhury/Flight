"use client";

import { useState } from "react";
import type { AppConfig, SearchRequest } from "@/lib/types";

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base dark:border-slate-600 dark:bg-slate-800";
const label = "mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300";

function defaultDate() {
  const d = new Date(Date.now() + 30 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function SearchForm({
  config,
  busy,
  onSearch,
}: {
  config: AppConfig;
  busy: boolean;
  onSearch: (req: SearchRequest) => void;
}) {
  const areas = [...new Set(config.groundAccess.map((g) => g.origin_area))];
  const dests = config.airports.filter((a) => a.role === "destination" && a.enabled);
  const ukAirports = config.airports.filter((a) => a.role === "uk_origin" && a.enabled);

  const [req, setReq] = useState<SearchRequest>({
    originArea: areas[0] ?? "",
    dest: dests.find((d) => d.iata === "GAU")?.iata ?? dests[0]?.iata ?? "",
    date: defaultDate(),
    flexDays: 0,
    adults: 1,
    children: 0,
    bags: 1,
    bagKg: 23,
    earliestDepartHour: null,
    latestArriveHour: null,
    minBufferMins: config.settings.min_buffer_mins,
    allowOvernight: false,
    ukAirports: ukAirports.map((a) => a.iata),
  });
  const [more, setMore] = useState(false);
  const [bufferHours, setBufferHours] = useState(String(config.settings.min_buffer_mins / 60));
  const set = <K extends keyof SearchRequest>(k: K, v: SearchRequest[K]) => setReq((r) => ({ ...r, [k]: v }));
  const hourOpt = (v: string) => (v === "" ? null : Number(v));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(req);
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="from">From</label>
          <select id="from" className={field} value={req.originArea} onChange={(e) => set("originArea", e.target.value)}>
            {areas.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="to">To</label>
          <select id="to" className={field} value={req.dest} onChange={(e) => set("dest", e.target.value)}>
            {dests.map((d) => <option key={d.iata} value={d.iata}>{d.city} ({d.iata})</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="date">Leaving on</label>
          <input id="date" type="date" className={field} value={req.date} onChange={(e) => set("date", e.target.value)} required />
        </div>
        <div>
          <label className={label} htmlFor="flex">Flexibility</label>
          <select id="flex" className={field} value={req.flexDays} onChange={(e) => set("flexDays", Number(e.target.value) as 0 | 1)}>
            <option value={0}>Exact date</option>
            <option value={1}>± 1 day (3× searches)</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="adults">Adults</label>
          <input id="adults" type="number" min={1} max={9} className={field} value={req.adults} onChange={(e) => set("adults", Number(e.target.value))} />
        </div>
        <div>
          <label className={label} htmlFor="children">Children</label>
          <input id="children" type="number" min={0} max={8} className={field} value={req.children} onChange={(e) => set("children", Number(e.target.value))} />
        </div>
        <div>
          <label className={label} htmlFor="bags">Checked bags each</label>
          <input id="bags" type="number" min={0} max={3} className={field} value={req.bags} onChange={(e) => set("bags", Number(e.target.value))} />
        </div>
        <div>
          <label className={label} htmlFor="kg">Weight per bag (kg)</label>
          <input id="kg" type="number" min={0} max={32} className={field} value={req.bagKg} onChange={(e) => set("bagKg", Number(e.target.value))} />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="buf">Time to change from international to domestic flight (hours)</label>
        <input
          id="buf"
          type="number"
          inputMode="decimal"
          min={1}
          max={12}
          step={0.25}
          className={field}
          value={bufferHours}
          onChange={(e) => {
            setBufferHours(e.target.value);
            const h = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(h)) set("minBufferMins", Math.round(h * 60));
          }}
          required
        />
        <p className="mt-1 text-xs text-slate-500">
          For separate tickets: immigration, collecting bags and checking in again. We add 45 min if you also change terminal (e.g. Delhi T3 → T1).
        </p>
      </div>

      <button type="button" className="text-sm font-medium text-sky-700 underline dark:text-sky-400" onClick={() => setMore((m) => !m)}>
        {more ? "Hide" : "More"} options
      </button>

      {more && (
        <div className="space-y-3 rounded-lg bg-slate-100 p-3 dark:bg-slate-800/60">
          <div>
            <span className={label}>UK airports</span>
            <div className="flex flex-wrap gap-3">
              {ukAirports.map((a) => (
                <label key={a.iata} className="flex items-center gap-1.5 text-base">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={req.ukAirports?.includes(a.iata) ?? true}
                    onChange={(e) =>
                      set("ukAirports", e.target.checked ? [...(req.ukAirports ?? []), a.iata] : (req.ukAirports ?? []).filter((x) => x !== a.iata))
                    }
                  />
                  {a.iata}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="edh">Leave UK after</label>
              <select id="edh" className={field} value={req.earliestDepartHour ?? ""} onChange={(e) => set("earliestDepartHour", hourOpt(e.target.value))}>
                <option value="">Any time</option>
                {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="lah">Arrive by (local)</label>
              <select id="lah" className={field} value={req.latestArriveHour ?? ""} onChange={(e) => set("latestArriveHour", hourOpt(e.target.value))}>
                <option value="">Any time</option>
                {Array.from({ length: 23 }, (_, i) => i).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:59</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-base">
            <input type="checkbox" className="h-5 w-5" checked={req.allowOvernight} onChange={(e) => set("allowOvernight", e.target.checked)} />
            Allow an overnight stop (adds a hotel estimate)
          </label>
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !req.ukAirports?.length}
        className="w-full rounded-lg bg-sky-700 px-4 py-3 text-lg font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Searching… (up to a minute)" : "Find flights"}
      </button>
    </form>
  );
}
