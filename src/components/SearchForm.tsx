"use client";

import { useState } from "react";
import { LONDON, UK_AIRPORTS, type NearbyAirport } from "@/lib/config/places";
import { AirportPicker } from "./AirportPicker";
import type { AppConfig, SearchRequest } from "@/lib/types";

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base dark:border-slate-600 dark:bg-slate-800";
const label = "mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300";

function defaultDate() {
  const d = new Date(Date.now() + 30 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const ukName = (code: string) => UK_AIRPORTS.find((a) => a.code === code)?.name ?? code;
const DEFAULT_AIRPORTS = [LONDON, "MAN", "BHX"];

export function SearchForm({
  config,
  busy,
  onSearch,
}: {
  config: AppConfig;
  busy: boolean;
  onSearch: (req: SearchRequest) => void;
}) {
  const [from, setFrom] = useState("");
  const [dest, setDest] = useState<string | null>("GAU");
  const [located, setLocated] = useState<{ name: string; airports: NearbyAirport[] } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateMsg, setLocateMsg] = useState("");
  const [airports, setAirports] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [more, setMore] = useState(false);
  const [tripType, setTripType] = useState<"oneway" | "return">("oneway");
  const [returnDate, setReturnDate] = useState("");
  const [bufferHours, setBufferHours] = useState(String(config.settings.min_buffer_mins / 60));
  const [req, setReq] = useState<Omit<SearchRequest, "originArea" | "dest" | "ukAirports">>({
    date: defaultDate(),
    flexDays: 0,
    adults: 1,
    children: 0,
    infants: 0,
    bags: 1,
    earliestDepartHour: null,
    latestArriveHour: null,
    minBufferMins: config.settings.min_buffer_mins,
    allowOvernight: false,
  });
  const set = <K extends keyof typeof req>(k: K, v: (typeof req)[K]) => setReq((r) => ({ ...r, [k]: v }));
  const hourOpt = (v: string) => (v === "" ? null : Number(v));

  async function findAirports() {
    const q = from.trim();
    if (q.length < 2 || q === located?.name) return;
    setLocating(true);
    setLocateMsg("");
    try {
      const res = await fetch(`/api/locate?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        setLocated(null);
        setLocateMsg(data.error ?? "Couldn't look that up.");
        if (!airports.length) setAirports(DEFAULT_AIRPORTS);
        return;
      }
      setLocated({ name: data.place.name, airports: data.airports });
      setAirports(data.airports.map((a: NearbyAirport) => a.code));
    } catch {
      setLocateMsg("Couldn't look that up — pick your airports below.");
      if (!airports.length) setAirports(DEFAULT_AIRPORTS);
    } finally {
      setLocating(false);
    }
  }

  const toggle = (code: string, on: boolean) => setAirports((a) => (on ? [...new Set([...a, code])] : a.filter((x) => x !== code)));
  const shown = [...new Set([...(located?.airports.map((a) => a.code) ?? []), ...airports])];
  const kmOf = (code: string) => located?.airports.find((a) => a.code === code)?.km;
  const addable = UK_AIRPORTS.filter((a) => !shown.includes(a.code));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!from.trim()) return setFormError("Enter where you're travelling from.");
    if (!dest) return setFormError("Pick a destination from the suggestions, or type its 3-letter airport code.");
    if (!airports.length) return setFormError("Pick at least one UK airport.");
    if (airports.length > 5) return setFormError("Pick at most 5 UK airports (each one adds searches).");
    if ((req.infants ?? 0) > req.adults) return setFormError("Each infant needs an adult (one infant per adult).");
    if (tripType === "return" && !returnDate) return setFormError("Pick the date you're coming back.");
    if (tripType === "return" && returnDate <= req.date) return setFormError("The return date must be after the departure date.");
    setFormError("");
    onSearch({ ...req, originArea: located?.name ?? from.trim(), dest, ukAirports: airports, returnDate: tripType === "return" ? returnDate : null });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div>
        <label className={label} htmlFor="from">From (UK town or postcode)</label>
        <div className="flex gap-2">
          <input
            id="from"
            className={field}
            placeholder="e.g. Stafford or ST16 2AA"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            onBlur={findAirports}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                findAirports();
              }
            }}
            autoComplete="address-level2"
            required
          />
          <button type="button" onClick={findAirports} className="shrink-0 rounded-lg border border-slate-300 px-3 text-sm font-medium dark:border-slate-600">
            {locating ? "…" : "Find airports"}
          </button>
        </div>
        {locateMsg && <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">{locateMsg}</p>}
      </div>

      {shown.length > 0 && (
        <fieldset>
          <legend className={label}>
            Fly from {located ? `(nearest to ${located.name})` : ""}
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {shown.map((code) => (
              <label key={code} className="flex items-center gap-1.5 text-base">
                <input type="checkbox" className="h-5 w-5" checked={airports.includes(code)} onChange={(e) => toggle(code, e.target.checked)} />
                {ukName(code)}
                {kmOf(code) != null && <span className="text-sm text-slate-500">{kmOf(code)} km</span>}
              </label>
            ))}
          </div>
          {addable.length > 0 && (
            <select
              aria-label="Add another UK airport"
              className="mt-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
              value=""
              onChange={(e) => e.target.value && toggle(e.target.value, true)}
            >
              <option value="">+ Add another airport</option>
              {addable.map((a) => (
                <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
              ))}
            </select>
          )}
          <p className="mt-1 text-xs text-slate-500">&quot;London (all airports)&quot; searches Heathrow, Gatwick, Stansted and others in one go.</p>
        </fieldset>
      )}

      <div>
        <label className={label} htmlFor="to">To (airport in India)</label>
        <AirportPicker
          id="to"
          country="IN"
          placeholder="Start typing a city, e.g. Guwahati"
          initial={{ code: "GAU", city: "Guwahati", name: "Lokpriya Gopinath Bordoloi International Airport", country: "IN", lat: 0, lon: 0 }}
          onChange={setDest}
        />
      </div>

      <div role="radiogroup" aria-label="Trip type" className="grid grid-cols-2 gap-1 rounded-lg bg-slate-200 p-1 dark:bg-slate-800">
        {(["oneway", "return"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={tripType === t}
            onClick={() => setTripType(t)}
            className={`rounded-md py-2 text-base font-medium ${tripType === t ? "bg-white shadow dark:bg-slate-600" : "text-slate-600 dark:text-slate-300"}`}
          >
            {t === "oneway" ? "One-way" : "Return"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="date">Leaving on</label>
          <input id="date" type="date" className={field} value={req.date} onChange={(e) => set("date", e.target.value)} required />
        </div>
        {tripType === "return" && (
          <div>
            <label className={label} htmlFor="ret">Coming back on</label>
            <input id="ret" type="date" className={field} min={req.date} value={returnDate} onChange={(e) => setReturnDate(e.target.value)} required />
          </div>
        )}
        <div>
          <label className={label} htmlFor="flex">Flexibility (outbound)</label>
          <select id="flex" className={field} value={req.flexDays} onChange={(e) => set("flexDays", Number(e.target.value) as 0 | 1)}>
            <option value={0}>Exact date</option>
            <option value={1}>± 1 day (3× searches)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={label} htmlFor="adults">Adults</label>
          <input id="adults" type="number" min={1} max={9} className={field} value={req.adults} onChange={(e) => set("adults", Number(e.target.value))} />
        </div>
        <div>
          <label className={label} htmlFor="children">Children <span className="font-normal text-slate-500">2–11</span></label>
          <input id="children" type="number" min={0} max={8} className={field} value={req.children} onChange={(e) => set("children", Number(e.target.value))} />
        </div>
        <div>
          <label className={label} htmlFor="infants">Infants <span className="font-normal text-slate-500">under 2</span></label>
          <input id="infants" type="number" min={0} max={req.adults} className={field} value={req.infants ?? 0} onChange={(e) => set("infants", Number(e.target.value))} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="bags">Checked bags each</label>
          <input id="bags" type="number" min={0} max={3} className={field} value={req.bags} onChange={(e) => set("bags", Number(e.target.value))} />
        </div>
        <div>
          <label className={label} htmlFor="buf">Change time (hours)</label>
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
        </div>
      </div>
      <p className="-mt-2 text-xs text-slate-500">
        Change time = time to switch between the international and domestic flights on separate tickets (immigration, bags, check-in) — used both ways on a return trip. We add 45 min if you also change terminal.
      </p>

      <button type="button" className="text-sm font-medium text-sky-700 underline dark:text-sky-400" onClick={() => setMore((m) => !m)}>
        {more ? "Hide" : "More"} options
      </button>

      {more && (
        <div className="space-y-3 rounded-lg bg-slate-100 p-3 dark:bg-slate-800/60">
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

      {formError && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{formError}</p>}
      <button type="submit" disabled={busy || locating} className="w-full rounded-lg bg-sky-700 px-4 py-3 text-lg font-semibold text-white disabled:opacity-50">
        {busy ? "Searching… (up to a minute)" : "Find flights"}
      </button>
    </form>
  );
}
