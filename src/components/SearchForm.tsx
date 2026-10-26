"use client";

import { useEffect, useRef, useState } from "react";
import { LONDON, UK_AIRPORTS, type NearbyAirport } from "@/lib/config/places";
import type { AirportRecord } from "@/lib/airports-index";
import { AirportPicker } from "./AirportPicker";
import { Icon, type IconName } from "./ui";
import type { AppConfig, SearchRequest } from "@/lib/types";

const box =
  "relative flex min-h-[3.75rem] items-center gap-2.5 rounded-xl border border-slate-300 bg-white px-3 transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-800/60";
const boxLabel = "block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const bare = "w-full bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400 dark:text-white";
const small = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800";
const smallLabel = "mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300";

function defaultDate() {
  const d = new Date(Date.now() + 30 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const ukName = (code: string) => UK_AIRPORTS.find((a) => a.code === code)?.name ?? code;
const DEFAULT_AIRPORTS = [LONDON, "MAN", "BHX"];

/** A labelled field box with an icon, the way big travel sites lay out their search bar. */
function Field({ icon, label, htmlFor, children, className = "" }: { icon?: IconName; label: string; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`${box} ${className}`}>
      {icon && <Icon name={icon} className="h-5 w-5 shrink-0 text-slate-400" />}
      <div className="min-w-0 flex-1 py-2">
        <label htmlFor={htmlFor} className={boxLabel}>{label}</label>
        {children}
      </div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-slate-100 p-1 dark:bg-slate-800">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${value === v ? "bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-600 hover:text-slate-900 dark:text-slate-300"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Stepper({ label, hint, value, min, max, onChange }: { label: string; hint?: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const btn = "flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-700 disabled:opacity-30 dark:border-slate-600 dark:text-slate-200";
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} className={btn} disabled={value <= min} onClick={() => onChange(value - 1)}>
          <Icon name="minus" className="h-4 w-4" />
        </button>
        <span className="tabular w-4 text-center font-semibold" aria-live="polite">{value}</span>
        <button type="button" aria-label={`More ${label.toLowerCase()}`} className={btn} disabled={value >= max} onClick={() => onChange(value + 1)}>
          <Icon name="plus" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
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
  const [fromMode, setFromMode] = useState<"uk" | "any">("uk");
  const [picked, setPicked] = useState<AirportRecord[]>([]);
  const [from, setFrom] = useState("");
  const [dest, setDest] = useState<string | null>("GAU");
  const [located, setLocated] = useState<{ name: string; lat: number; lon: number; airports: NearbyAirport[] } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateMsg, setLocateMsg] = useState("");
  const [airports, setAirports] = useState<string[]>([]);
  // The error remembers the inputs it was about, so it disappears as soon as they change.
  const [formErrorState, setFormErrorState] = useState({ msg: "", inputs: "" });
  const [more, setMore] = useState(false);
  const [paxOpen, setPaxOpen] = useState(false);
  const paxRef = useRef<HTMLDivElement>(null);
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

  // Close the travellers pop-up on a click outside it.
  useEffect(() => {
    if (!paxOpen) return;
    const close = (e: MouseEvent) => paxRef.current && !paxRef.current.contains(e.target as Node) && setPaxOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [paxOpen]);

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
      setLocated({ name: data.place.name, lat: data.place.lat, lon: data.place.lon, airports: data.airports });
      setAirports(data.airports.map((a: NearbyAirport) => a.code));
    } catch {
      setLocateMsg("Couldn't look that up — pick your airports below.");
      if (!airports.length) setAirports(DEFAULT_AIRPORTS);
    } finally {
      setLocating(false);
    }
  }

  const inputs = JSON.stringify([fromMode, picked.map((a) => a.code), from, dest, airports, tripType, returnDate, req]);
  const formError = formErrorState.inputs === inputs ? formErrorState.msg : "";
  const setFormError = (msg: string) => setFormErrorState({ msg, inputs });

  const toggle = (code: string, on: boolean) => setAirports((a) => (on ? [...new Set([...a, code])] : a.filter((x) => x !== code)));
  const shown = [...new Set([...(located?.airports.map((a) => a.code) ?? []), ...airports])];
  const kmOf = (code: string) => located?.airports.find((a) => a.code === code)?.km;
  const addable = UK_AIRPORTS.filter((a) => !shown.includes(a.code));
  const travellers = req.adults + req.children + (req.infants ?? 0);
  const paxText = `${travellers} ${travellers === 1 ? "person" : "people"} · ${req.bags} bag${req.bags === 1 ? "" : "s"}`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const origins = fromMode === "uk" ? airports : picked.map((a) => a.code);
    if (fromMode === "uk" && !from.trim()) return setFormError("Enter where you're travelling from.");
    if (!dest) return setFormError("Pick a destination from the suggestions, or type its 3-letter airport code.");
    if (!origins.length) return setFormError(fromMode === "uk" ? "Pick at least one UK airport." : "Pick at least one departure airport.");
    if (origins.length > 5) return setFormError("Pick at most 5 departure airports (each one adds searches).");
    if ((req.infants ?? 0) > req.adults) return setFormError("Each infant needs an adult (one infant per adult).");
    if (tripType === "return" && !returnDate) return setFormError("Pick the date you're coming back.");
    if (tripType === "return" && returnDate <= req.date) return setFormError("The return date must be after the departure date.");
    setFormError("");
    onSearch({
      ...req,
      originArea: fromMode === "uk" ? (located?.name ?? from.trim()) : "",
      originLatLon: fromMode === "uk" && located ? { lat: located.lat, lon: located.lon } : null,
      dest,
      ukAirports: origins,
      returnDate: tripType === "return" ? returnDate : null,
    });
  }

  return (
    <form onSubmit={submit}>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Trip type" value={tripType} onChange={setTripType} options={[["oneway", "One-way"], ["return", "Return"]]} />
        <Segmented label="Where from" value={fromMode} onChange={setFromMode} options={[["uk", "From the UK"], ["any", "Any airport"]]} />
      </div>

      <div className={`mt-4 grid gap-2 sm:grid-cols-2 ${tripType === "return" ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9.5rem_9.5rem_13.5rem_auto]" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_13.5rem_auto]"}`}>
        {fromMode === "uk" ? (
          <Field icon="pin" label="From" htmlFor="from">
            <div className="flex items-center gap-2">
              <input
                id="from"
                className={bare}
                placeholder="UK town or postcode"
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
              />
              <button
                type="button"
                onClick={findAirports}
                aria-label="Find airports"
                title="Find airports near here"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-brand-600 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30"
              >
                {locating ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Icon name="search" className="h-4 w-4" strokeWidth={2.2} />}
              </button>
            </div>
          </Field>
        ) : (
          <Field icon="takeoff" label="From (up to 5 airports)" htmlFor="from-any">
            <AirportPicker
              id="from-any"
              inputClassName={bare}
              placeholder="City or airport, e.g. Frankfurt"
              onPick={(a) => {
                setPicked((p) => (p.some((x) => x.code === a.code) || p.length >= 5 ? p : [...p, a]));
              }}
            />
          </Field>
        )}

        <Field icon="landing" label="To" htmlFor="to">
          <AirportPicker
            id="to"
            country="IN"
            inputClassName={bare}
            placeholder="City or airport in India"
            initial={{ code: "GAU", city: "Guwahati", name: "Lokpriya Gopinath Bordoloi International Airport", country: "IN", lat: 0, lon: 0 }}
            onChange={setDest}
          />
        </Field>

        <Field label="Depart" htmlFor="date">
          <input id="date" type="date" className={bare} value={req.date} onChange={(e) => set("date", e.target.value)} required />
        </Field>

        {tripType === "return" && (
          <Field label="Return" htmlFor="ret">
            <input id="ret" type="date" className={bare} min={req.date} value={returnDate} onChange={(e) => setReturnDate(e.target.value)} required />
          </Field>
        )}

        <div ref={paxRef} className={`relative ${tripType === "return" ? "sm:col-span-2 lg:col-span-1" : ""}`}>
          <button
            type="button"
            aria-expanded={paxOpen}
            aria-label={`Travellers and bags: ${paxText}`}
            onClick={() => setPaxOpen((o) => !o)}
            className={`${box} w-full text-left`}
          >
            <Icon name="user" className="h-5 w-5 shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1 py-2">
              <span className={boxLabel}>Travellers &amp; bags</span>
              <span className="block truncate text-base font-semibold text-slate-900 dark:text-white">{paxText}</span>
            </span>
          </button>
          {paxOpen && (
            <div className="absolute left-0 right-0 top-full z-40 mt-2 divide-y sm:left-auto sm:w-72 divide-slate-100 rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-slate-200 dark:divide-slate-800 dark:bg-slate-900 dark:ring-slate-700">
              <Stepper label="Adults" hint="12 and over" value={req.adults} min={1} max={9} onChange={(n) => setReq((r) => ({ ...r, adults: n, infants: Math.min(r.infants ?? 0, n) }))} />
              <Stepper label="Children" hint="2–11" value={req.children} min={0} max={8} onChange={(n) => set("children", n)} />
              <Stepper label="Infants" hint="Under 2, on your lap" value={req.infants ?? 0} min={0} max={req.adults} onChange={(n) => set("infants", n)} />
              <Stepper label="Checked bags" hint="Per traveller (not infants)" value={req.bags} min={0} max={3} onChange={(n) => set("bags", n)} />
              <div className="pt-3">
                <button type="button" onClick={() => setPaxOpen(false)} className="w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={busy || locating}
          className="flex min-h-[3.75rem] items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-700 disabled:opacity-60 sm:col-span-2 lg:col-span-1"
        >
          <Icon name="search" className="h-5 w-5" strokeWidth={2.2} />
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      {fromMode === "uk" && (locateMsg || shown.length > 0) && (
        <div className="mt-3">
          {locateMsg && <p className="mb-2 text-sm text-amber-800 dark:text-amber-300">{locateMsg}</p>}
          {shown.length > 0 && (
            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                Fly from {located ? `— nearest to ${located.name}` : ""}
              </legend>
              <div className="flex flex-wrap items-center gap-2">
                {shown.map((code) => {
                  const on = airports.includes(code);
                  return (
                    <label
                      key={code}
                      className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${on ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-100" : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"}`}
                    >
                      <input type="checkbox" className="sr-only" checked={on} onChange={(e) => toggle(code, e.target.checked)} />
                      {on && <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.6} />}
                      {ukName(code)}
                      {kmOf(code) != null && <span className="text-xs font-normal text-slate-500">{kmOf(code)} km</span>}
                    </label>
                  );
                })}
                {addable.length > 0 && (
                  <select
                    aria-label="Add another UK airport"
                    className="rounded-full border border-dashed border-slate-300 bg-transparent px-3 py-1.5 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
                    value=""
                    onChange={(e) => e.target.value && toggle(e.target.value, true)}
                  >
                    <option value="">+ Add airport</option>
                    {addable.map((a) => (
                      <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
                    ))}
                  </select>
                )}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">&quot;London (all airports)&quot; searches Heathrow, Gatwick, Stansted and others in one go.</p>
            </fieldset>
          )}
        </div>
      )}

      {fromMode === "any" && (
        <div className="mt-3">
          {picked.length > 0 && (
            <ul className="mb-1.5 flex flex-wrap gap-2" aria-label="Departure airports">
              {picked.map((a) => (
                <li key={a.code} className="flex items-center gap-1 rounded-full border border-brand-500 bg-brand-50 py-1 pl-3 pr-1 text-sm font-medium text-brand-800 dark:bg-brand-900/40 dark:text-brand-100">
                  {a.city} ({a.code})
                  <button
                    type="button"
                    aria-label={`Remove ${a.code}`}
                    className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-brand-100 dark:hover:bg-brand-800"
                    onClick={() => setPicked((p) => p.filter((x) => x.code !== a.code))}
                  >
                    <Icon name="x" className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">Tip: a 3-letter city code like PAR or NYC (then Enter) searches all of that city&apos;s airports.</p>
        </div>
      )}

      <div className="mt-3">
        <button type="button" aria-expanded={more} className="flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => setMore((m) => !m)}>
          <Icon name="sliders" className="h-4 w-4" />
          {more ? "Fewer options" : "More options"}
          <Icon name="chevronDown" className={`h-4 w-4 transition ${more ? "rotate-180" : ""}`} />
        </button>
        {more && (
          <div className="mt-3 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4 dark:bg-slate-800/50">
            <div>
              <label className={smallLabel} htmlFor="buf">Change time on separate tickets (hours)</label>
              <input
                id="buf"
                type="number"
                inputMode="decimal"
                min={1}
                max={12}
                step={0.25}
                className={small}
                value={bufferHours}
                onChange={(e) => {
                  setBufferHours(e.target.value);
                  const h = Number(e.target.value);
                  if (e.target.value !== "" && Number.isFinite(h)) set("minBufferMins", Math.round(h * 60));
                }}
                required
              />
              <p className="mt-1 text-xs text-slate-500">Time for immigration, bags and check-in between flights. We add 45 min for a terminal change.</p>
            </div>
            <div>
              <label className={smallLabel} htmlFor="flex">Departure date</label>
              <select id="flex" className={small} value={req.flexDays} onChange={(e) => set("flexDays", Number(e.target.value) as 0 | 1)}>
                <option value={0}>Exact date</option>
                <option value={1}>± 1 day (3× searches)</option>
              </select>
            </div>
            <div>
              <label className={smallLabel} htmlFor="edh">Leave the UK after</label>
              <select id="edh" className={small} value={req.earliestDepartHour ?? ""} onChange={(e) => set("earliestDepartHour", hourOpt(e.target.value))}>
                <option value="">Any time</option>
                {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </div>
            <div>
              <label className={smallLabel} htmlFor="lah">Arrive by (local time)</label>
              <select id="lah" className={small} value={req.latestArriveHour ?? ""} onChange={(e) => set("latestArriveHour", hourOpt(e.target.value))}>
                <option value="">Any time</option>
                {Array.from({ length: 23 }, (_, i) => i).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:59</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
              <input type="checkbox" className="h-4 w-4" checked={req.allowOvernight} onChange={(e) => set("allowOvernight", e.target.checked)} />
              Allow an overnight stop between flights (adds a hotel estimate)
            </label>
          </div>
        )}
      </div>

      {formError && (
        <p role="alert" className="mt-3 flex items-center gap-2 text-sm font-medium text-rose-700 dark:text-rose-300">
          <Icon name="alert" className="h-4 w-4" /> {formError}
        </p>
      )}
    </form>
  );
}
