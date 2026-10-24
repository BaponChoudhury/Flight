"use client";

import { useEffect, useState } from "react";
import type { AppConfig, SearchRequest, SearchResponse } from "@/lib/types";
import { Results } from "./Results";
import { SearchForm } from "./SearchForm";

export function SearchApp() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ data: SearchResponse; req: SearchRequest } | null>(null);

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

  return (
    <div className="space-y-6">
      {!hasApiKey && (
        <p role="alert" className="mx-auto max-w-2xl rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          IGNAV_API_KEY isn&apos;t set on the server, so searches will fail. See the README.
        </p>
      )}
      <div className="mx-auto max-w-2xl space-y-6">
        {config ? <SearchForm config={config} busy={busy} onSearch={search} /> : !error && <p>Loading…</p>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-900 dark:bg-rose-900/30 dark:text-rose-100">{error}</p>}
      </div>
      {result && config && <Results data={result.data} req={result.req} settings={config.settings} />}
    </div>
  );
}
