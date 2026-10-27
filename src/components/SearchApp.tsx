"use client";

import { useEffect, useState } from "react";
import type { AppConfig, SearchRequest, SearchResponse } from "@/lib/types";
import { Results } from "./Results";
import { SearchForm } from "./SearchForm";
import { card, Icon } from "./ui";

const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function travellerText(r: SearchRequest) {
  const n = r.adults + r.children + (r.infants ?? 0);
  return `${n} traveller${n === 1 ? "" : "s"}`;
}

const SEARCH_STEPS = [
  "Checking airline tickets from your airports",
  "Looking for cheaper split tickets",
  "Comparing prices from two flight sources",
  "Checking connection times, terminals and baggage",
  "Putting the best options together",
];

/** Shown while a search runs (it can take up to a minute). */
function Searching() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, SEARCH_STEPS.length - 1)), 6000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="mt-6 space-y-4" aria-live="polite">
      <div className={`${card} overflow-hidden p-5`}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <Icon name="search" />
          </span>
          <div>
            <p className="font-semibold">Searching for the best routes…</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">{SEARCH_STEPS[step]}</p>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="animate-indeterminate h-full w-2/5 rounded-full bg-brand-500" />
        </div>
        <p className="mt-2 text-xs text-slate-500">This can take up to a minute. We check many more combinations than a normal flight search.</p>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${card} flex animate-pulse items-center gap-4 p-5`}>
          <div className="h-9 w-9 rounded-md bg-slate-200 dark:bg-slate-800" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-3 w-1/3 rounded bg-slate-100 dark:bg-slate-800/70" />
          </div>
          <div className="h-8 w-20 rounded bg-slate-200 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

export function SearchApp() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ data: SearchResponse; req: SearchRequest } | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        setConfig(d.config);
        setHasApiKey(d.hasApiKey);
      })
      .catch(() => setError("Couldn't load settings. Is the server running?"));
  }, []);

  async function search(req: SearchRequest) {
    setBusy(true);
    setError("");
    setEditing(false);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Search failed.");
      else setResult({ data, req });
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const form = config ? <SearchForm config={config} busy={busy} onSearch={search} /> : !error && <p className="p-6 text-slate-500">Loading…</p>;
  const compact = !!result || busy;
  const r = result?.req;

  return (
    <>
      {/* Full-bleed brand band behind the search card. */}
      <div className="relative bg-brand-950 px-4 pb-24 pt-8 text-white sm:pt-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_25rem_at_80%_-10%,rgba(59,102,245,0.45),transparent)]" />
        <div className="relative mx-auto max-w-6xl">
          {!compact ? (
            <>
              <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">Fly from the UK to anywhere — for less.</h1>
              <p className="mt-2 max-w-2xl text-base text-white/75 sm:text-lg">
                We compare airline tickets from two flight sources, add smart split tickets via Indian hubs for trips to India, and check every connection for you.
              </p>
              <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/80">
                {["Two flight sources compared", "Safe connection times checked", "Bags included in the price"].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Icon name="check" className="h-4 w-4 text-brand-300" strokeWidth={2.4} />
                    {t}
                  </li>
                ))}
              </ul>
            </>
          ) : r && !editing && !busy ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xl font-bold tracking-tight sm:text-2xl">
                  {r.originArea || (r.ukAirports ?? []).join(", ")} <span className="text-white/50">→</span> {r.dest}
                </p>
                <p className="text-sm text-white/70">
                  {fmtDate(r.date)}
                  {r.returnDate ? ` – ${fmtDate(r.returnDate)}` : " · one-way"} · {travellerText(r)} · {r.bags} bag{r.bags === 1 ? "" : "s"} each
                  {result && ` · ${result.data.options.length} routes found`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold ring-1 ring-white/20 hover:bg-white/20"
              >
                <Icon name="search" className="h-4 w-4" /> Edit search
              </button>
            </div>
          ) : (
            <p className="text-xl font-bold tracking-tight">{busy ? "Searching…" : "Change your search"}</p>
          )}
        </div>
      </div>

      <div className="relative -mt-20 mx-auto max-w-6xl px-4">
        {!hasApiKey && (
          <p role="alert" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-100">
            IGNAV_API_KEY isn&apos;t set on the server, so searches will fail. See the README.
          </p>
        )}
        {/* The form stays mounted (keeps what was typed) and is hidden behind the summary once results are in. */}
        <div className={`${card} p-4 shadow-xl shadow-brand-950/10 sm:p-6 ${compact && !editing && result ? "hidden" : ""}`}>{form}</div>
        {error && (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-rose-900 ring-1 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-100 dark:ring-rose-900">
            <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0" /> {error}
          </p>
        )}
        {busy && <Searching />}
        {!busy && result && config && (
          <div className="mt-6">
            <Results data={result.data} req={result.req} settings={config.settings} />
          </div>
        )}
      </div>
    </>
  );
}
