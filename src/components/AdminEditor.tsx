"use client";

import { useEffect, useState } from "react";
import type { AppConfig } from "@/lib/types";

type Row = Record<string, unknown>;

const TABLES: { table: string; key: keyof AppConfig; title: string; help: string; blank: Row }[] = [
  { table: "ground_access", key: "groundAccess", title: "Ground travel to UK airports", help: "Cost and time from home to each airport. per_person = train fare per traveller; untick for car/taxi.", blank: { origin_area: "Stafford", airport: "", mode: "train", cost_gbp: 0, per_person: true, duration_mins: 0, notes: "" } },
  { table: "airports", key: "airports", title: "Airports", help: "role: uk_origin, india_hub or destination. tz is the IANA timezone.", blank: { iata: "", name: "", city: "", tz: "Asia/Kolkata", role: "destination", enabled: true } },
  { table: "bag_fees", key: "bagFees", title: "Bag fees", help: "Price per extra checked bag, per traveller. airline_code * = any airline.", blank: { airline_code: "", route_type: "domestic", bag_kg: 15, fee_gbp: 0, notes: "" } },
  { table: "airline_bag_defaults", key: "airlineBagDefaults", title: "Baggage allowances", help: "included_kg per bag drives the excess-baggage warning. included_pieces is only used if the airline data is missing.", blank: { airline_code: "", route_type: "domestic", included_pieces: null, included_kg: 15, excess_per_kg_gbp: null, notes: "" } },
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

function TableEditor({ spec, initial }: { spec: (typeof TABLES)[number]; initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [status, setStatus] = useState("");
  const cols = Object.keys(rows[0] ?? spec.blank);

  async function save() {
    setStatus("Saving…");
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
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
        <button type="button" className="rounded bg-sky-700 px-3 py-1 text-sm font-semibold text-white" onClick={save}>Save</button>
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
    const res = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) });
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
        <button type="button" className="rounded bg-sky-700 px-3 py-1 text-sm font-semibold text-white" onClick={save}>Save</button>
        <span className="text-sm">{status}</span>
      </div>
    </details>
  );
}

export function AdminEditor() {
  const [data, setData] = useState<{ config: AppConfig; storage: string; hasApiKey: boolean } | null>(null);
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
      {TABLES.map((t) => <TableEditor key={t.table} spec={t} initial={data.config[t.key] as unknown as Row[]} />)}
      <SettingsEditor initial={data.config.settings} />
    </div>
  );
}
