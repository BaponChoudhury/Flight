"use client";

import { useState } from "react";
import type { RouteOption } from "@/lib/types";
import { Icon } from "./ui";

export interface OptedIn {
  email: string;
  sendAfter: string;
}

/**
 * "Free compensation check for this trip": one email the day after the trip, if they opt in.
 * `done`/`onDone` are shared by every copy on a result (the box in the details and the prompt
 * shown when "Where to book" is clicked), so opting in once updates both.
 */
export function FollowupOptIn({
  o,
  searchId,
  done,
  onDone,
  prompt = false,
}: {
  o: RouteOption;
  searchId: string;
  done: OptedIn | null;
  onDone: (d: OptedIn) => void;
  prompt?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const legs = [...o.legs, ...(o.back?.legs ?? [])];
  const flights = legs.flatMap((l) =>
    l.itinerary.segments.map((s) => ({ carrier: s.carrier, flightNumber: s.flightNumber, from: s.origin, to: s.dest, departUtc: s.departUtc, arriveUtc: s.arriveUtc })),
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!consent) return setError("Tick the box to agree.");
    setBusy(true);
    try {
      const res = await fetch("/api/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, consent, searchId, trip: { origin: flights[0].from, dest: o.dest, flights } }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error ?? "Something went wrong.");
      else onDone({ email: email.trim(), sendAfter: d.sendAfter });
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const when = done ? new Date(`${done.sendAfter}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : "";
  return (
    <div className="rounded-2xl bg-emerald-50 p-4 text-sm ring-1 ring-emerald-200 dark:bg-emerald-900/25 dark:ring-emerald-800">
      <p className="flex items-center gap-2 font-bold text-emerald-900 dark:text-emerald-100">
        <Icon name="shield" className="h-4 w-4" /> {prompt && !done ? "Before you book: free compensation check" : "Free compensation check for this trip"}
      </p>
      {done ? (
        <p className="mt-1 text-emerald-900/90 dark:text-emerald-100/90">
          You&apos;re in. We&apos;ll email <strong>{done.email}</strong> on {when} with a quick link to claim if a flight was disrupted.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-1 space-y-2">
          <p className="text-emerald-900/90 dark:text-emerald-100/90">
            If any of these flights is delayed by 3+ hours, cancelled, or you&apos;re denied boarding, you may be owed up to £520. We&apos;ll email you after
            your trip with a quick link to claim. Free, no obligation, unsubscribe anytime (<a href="/privacy" className="underline">privacy notice</a>).
          </p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span className="text-emerald-950 dark:text-emerald-50">Yes, check my trip for compensation</span>
          </label>
          <div className="flex gap-2">
            <input
              type="email"
              required
              aria-label="Your email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-base outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15 dark:border-emerald-700 dark:bg-slate-900"
              autoComplete="email"
            />
            <button type="submit" disabled={busy} className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
              {busy ? "…" : "Check my trip"}
            </button>
          </div>
          {error && <p className="text-rose-700 dark:text-rose-300">{error}</p>}
        </form>
      )}
    </div>
  );
}
