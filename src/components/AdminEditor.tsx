"use client";

import { useEffect, useState } from "react";
import type { AppConfig } from "@/lib/types";
import type { BookingClick } from "@/lib/store";

type Row = Record<string, unknown>;

const TABLES: { table: string; key: keyof AppConfig; title: string; help: string; blank: Row }[] = [
  { table: "ground_access", key: "groundAccess", title: "Ground travel to UK airports", help: "Cost and time from home to each airport. per_person = train fare per traveller; untick for car/taxi.", blank: { origin_area: "Stafford", airport: "", mode: "train", cost_gbp: 0, per_person: true, duration_mins: 0, notes: "" } },
  { table: "airports", key: "airports", title: "Airports", help: "role: uk_origin, india_hub or destination. tz is the IANA timezone.", blank: { iata: "", name: "", city: "", tz: "Asia/Kolkata", role: "destination", enabled: true } },
  { table: "airline_bag_defaults", key: "airlineBagDefaults", title: "Baggage allowances", help: "included_kg per bag drives the excess-baggage warning only. Bag prices themselves come from Ignav (bag-inclusive fares).", blank: { airline_code: "", route_type: "domestic", included_pieces: null, included_kg: 15, excess_per_kg_gbp: null, notes: "" } },
  { table: "airline_terminals", key: "airlineTerminals", title: "Terminals", help: "Which terminal an airline uses at a hub, for spotting terminal changes.", blank: { airport: "", airline_code: "", route_type: "domestic", terminal: "" } },
  { table: "terminal_rules", key: "terminalRules", title: "Terminal change time", help: "Extra minutes added to the connection when changing terminals.", blank: { airport: "", from_terminal: "", to_terminal: "", extra_mins: 45 } },
  { table: "hub_routes", key: "hubRoutes", title: "Which hubs fly to which destination", help: "Learned automatically. Untick has_service to stop searching a hub for a destination.", blank: { hub: "", dest: "", has_service: true, last_checked_at: new Date().toISOString() } },
];

const input = "w-full min-w-20 rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800";

function coerce(value: string, previous: unknown): unknown {
  if (typeof previous === "number" || previous === null) {
    if (value.trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

const ADMIN_KEY = "flight-admin-key";

function adminKey(): string {
  try {
    return sessionStorage.getItem(ADMIN_KEY) ?? "";
  } catch {
    return "";
  }
}

function adminHeaders(): HeadersInit {
  return { "Content-Type": "application/json", "x-admin-key": adminKey() };
}

interface FareRequestRow {
  id: string;
  created_at: string;
  status: string;
  contact: { name: string; email: string; phone: string };
  notes: string | null;
  quote: {
    market: string;
    provider_name: string;
    booking_url: string;
    fare_name: string | null;
    local_amount: number;
    local_currency: string;
    mid_rate: number;
    applied_rate: number;
    price_gbp: number;
    uk_price_gbp: number | null;
    expires_at: string;
    passengers: { adults: number; children: number; infants: number };
    itinerary: { origin: string; dest: string; date: string; carrier: string | null; flightNumber: string | null; ret?: { date: string } };
  } | null;
}

function FareRequests() {
  const [rows, setRows] = useState<FareRequestRow[] | null>(null);
  const [error, setError] = useState("");
  async function load() {
    setError("");
    const res = await fetch("/api/fare-requests", { headers: adminHeaders() });
    const d = await res.json();
    if (!res.ok) {
      setError(d.error ?? "Failed");
      setRows(null);
      return;
    }
    setRows(d.requests);
  }
  useEffect(() => {
    load();
  }, []);
  return (
    <details open className="rounded-lg border border-amber-300 bg-white p-3 dark:border-amber-700 dark:bg-slate-900">
      <summary className="cursor-pointer font-semibold">Fare requests to book {rows ? `(${rows.length})` : ""}</summary>
      <p className="my-2 text-sm text-slate-600 dark:text-slate-400">
        Customers asked us to book these lower prices. The market, seller and local price are only shown here. Check the price is still available
        before contacting the customer — quotes are valid for 30 minutes.
      </p>
      <button type="button" className="mb-2 rounded border border-slate-300 px-3 py-1 text-sm dark:border-slate-600" onClick={load}>Refresh</button>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {rows?.length === 0 && <p className="text-sm">No requests yet.</p>}
      <ul className="space-y-3">
        {rows?.map((r) => {
          const q = r.quote;
          const it = q?.itinerary;
          return (
            <li key={r.id} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
              <p className="font-semibold">
                {r.contact.name} · {r.contact.email} · {r.contact.phone}
                <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs dark:bg-slate-700">{r.status}</span>
              </p>
              <p className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString("en-GB")} · {r.id}</p>
              {q && it ? (
                <>
                  <p>
                    {it.origin} → {it.dest} on {it.date}{it.ret ? `, back ${it.ret.date}` : ""} · first flight {it.carrier}{it.flightNumber} ·{" "}
                    {q.passengers.adults} adult(s){q.passengers.children ? `, ${q.passengers.children} child(ren)` : ""}{q.passengers.infants ? `, ${q.passengers.infants} infant(s)` : ""}
                  </p>
                  <p>
                    Quoted <strong>£{q.price_gbp.toFixed(2)}</strong>
                    {q.uk_price_gbp != null && ` (UK price £${q.uk_price_gbp.toFixed(2)})`} · market <strong>{q.market}</strong> · {q.provider_name}
                    {q.fare_name && ` · ${q.fare_name}`} · {q.local_amount.toLocaleString("en-GB")} {q.local_currency} at {q.applied_rate.toFixed(4)} (mid {q.mid_rate.toFixed(4)})
                  </p>
                  <a href={q.booking_url} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline dark:text-brand-300">Open seller ↗</a>
                </>
              ) : (
                <p>Quote missing.</p>
              )}
              {r.notes && <p className="mt-1 italic">“{r.notes}”</p>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function BookingClicks() {
  const [rows, setRows] = useState<BookingClick[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  async function load() {
    setError("");
    const res = await fetch("/api/booking-clicks", { headers: adminHeaders() });
    const d = await res.json();
    if (!res.ok) {
      setError(d.error ?? "Failed");
      setRows(null);
      return;
    }
    setRows(d.clicks);
  }
  useEffect(() => {
    load();
  }, []);
  const q = filter.trim().toLowerCase();
  const shown = rows?.filter((r) => !q || r.sub_id.toLowerCase().includes(q));
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <summary className="cursor-pointer font-semibold">Aviasales booking clicks {rows ? `(${rows.length})` : ""}</summary>
      <p className="my-2 text-sm text-slate-600 dark:text-slate-400">
        Every Aviasales booking link we hand out carries its own SubID. When a booking appears in Travelpayouts (Statistics → Aviasales → Bookings, SubID
        column), paste the SubID here to see which trip and price it came from. Bookings show up in Travelpayouts with a delay; commission is confirmed
        after the trip.
      </p>
      <div className="mb-2 flex gap-2">
        <input className={input} placeholder="Find a SubID" aria-label="Find a SubID" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm dark:border-slate-600" onClick={load}>Refresh</button>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {shown?.length === 0 && <p className="text-sm">{q ? "No click with that SubID." : "No booking links handed out yet."}</p>}
      {shown && shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-1 pr-3">SubID</th>
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3">Trip</th>
                <th className="py-1 pr-3">Flights</th>
                <th className="py-1 pr-3">Seller</th>
                <th className="py-1 pr-3 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.sub_id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-3 font-mono text-xs">{r.sub_id}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {r.origin ?? "?"} → {r.dest ?? "?"} {r.depart_date ?? ""}
                    {r.return_date ? `, back ${r.return_date}` : ""} · {r.passengers.adults + r.passengers.children + r.passengers.infants} pax
                  </td>
                  <td className="py-1 pr-3">{r.flights ?? "—"}</td>
                  <td className="py-1 pr-3">{r.seller ?? "—"}</td>
                  <td className="py-1 pr-3 text-right">{r.price_gbp != null ? `£${r.price_gbp.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function AdminKeyBox({ onSet }: { onSet: () => void }) {
  const [value, setValue] = useState(adminKey());
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          sessionStorage.setItem(ADMIN_KEY, value);
        } catch {
          /* storage unavailable */
        }
        onSet();
      }}
    >
      <input type="password" placeholder="Admin password" className={input} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Admin password" />
      <button type="submit" className="rounded bg-brand-600 px-3 py-1 text-sm font-semibold text-white">Unlock</button>
    </form>
  );
}

function TableEditor({ spec, initial }: { spec: (typeof TABLES)[number]; initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [status, setStatus] = useState("");
  const cols = Object.keys(rows[0] ?? spec.blank);

  async function save() {
    setStatus("Saving…");
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ table: spec.table, rows }),
    });
    const d = await res.json();
    setStatus(res.ok ? "Saved" : `Error: ${d.error}`);
  }

  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <summary className="cursor-pointer font-semibold">{spec.title} ({rows.length})</summary>
      <p className="my-2 text-sm text-slate-600 dark:text-slate-400">{spec.help}</p>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr>{cols.map((c) => <th key={c} className="px-1 text-left font-medium">{c}</th>)}<th /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c} className="px-1 py-0.5">
                    {typeof r[c] === "boolean" ? (
                      <input type="checkbox" className="h-5 w-5" checked={r[c] as boolean} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, [c]: e.target.checked } : x)))} />
                    ) : (
                      <input
                        className={input}
                        value={r[c] == null ? "" : String(r[c])}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, [c]: coerce(e.target.value, spec.blank[c] ?? x[c]) } : x)))}
                      />
                    )}
                  </td>
                ))}
                <td><button type="button" className="px-2 text-rose-700" aria-label="Delete row" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm dark:border-slate-600" onClick={() => setRows([...rows, { ...spec.blank }])}>Add row</button>
        <button type="button" className="rounded bg-brand-600 px-3 py-1 text-sm font-semibold text-white" onClick={save}>Save</button>
        <span className="text-sm">{status}</span>
      </div>
    </details>
  );
}

function SettingsEditor({ initial }: { initial: AppConfig["settings"] }) {
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [status, setStatus] = useState("");
  async function save() {
    let settings;
    try {
      settings = JSON.parse(text);
    } catch {
      setStatus("Not valid JSON");
      return;
    }
    const res = await fetch("/api/config", { method: "PUT", headers: adminHeaders(), body: JSON.stringify({ settings }) });
    const d = await res.json();
    setStatus(res.ok ? "Saved" : `Error: ${d.error}`);
  }
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <summary className="cursor-pointer font-semibold">Search settings (buffers, pruning, cache, FX)</summary>
      <p className="my-2 text-sm text-slate-600 dark:text-slate-400">
        Times are in minutes. min_buffer_mins 210 = 3h 30m. prune_factor drops international flights costing more than this × the cheapest through ticket.
      </p>
      <textarea className={`${input} h-96 font-mono`} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className="rounded bg-brand-600 px-3 py-1 text-sm font-semibold text-white" onClick={save}>Save</button>
        <span className="text-sm">{status}</span>
      </div>
    </details>
  );
}

export function AdminEditor() {
  const [data, setData] = useState<{ config: AppConfig; storage: string; hasApiKey: boolean } | null>(null);
  const [keyVersion, setKeyVersion] = useState(0);
  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setData);
  }, []);
  if (!data) return <p>Loading…</p>;
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Admin</h1>
      <p className="text-sm">
        Storage: <strong>{data.storage}</strong>
        {data.storage === "memory" && " — changes are lost when the server restarts. Connect Supabase to keep them."} · Ignav key:{" "}
        <strong>{data.hasApiKey ? "set" : "missing"}</strong>
      </p>
      <AdminKeyBox onSet={() => setKeyVersion((v) => v + 1)} />
      <FareRequests key={keyVersion} />
      <BookingClicks key={`clicks-${keyVersion}`} />
      {TABLES.map((t) => <TableEditor key={t.table} spec={t} initial={data.config[t.key] as unknown as Row[]} />)}
      <SettingsEditor initial={data.config.settings} />
    </div>
  );
}
