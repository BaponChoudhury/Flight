"use client";

import { useState } from "react";
import { card, Icon } from "./ui";

/** Email-link sign-in. Marketing consent is a separate, unticked box (UK GDPR). */
export function SignIn({ next, title, intro }: { next: string; title: string; intro: string }) {
  const [email, setEmail] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setState("sending");
    const res = await fetch("/api/auth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, marketing, next }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error ?? "Something went wrong. Please try again.");
      setState("idle");
      return;
    }
    setState("sent");
  }

  return (
    <div className={`${card} mx-auto max-w-md p-6 sm:p-8`}>
      {state === "sent" ? (
        <div className="text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <Icon name="check" strokeWidth={2.6} />
          </span>
          <h2 className="mt-3 text-lg font-bold">Check your email</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            We sent a sign-in link to <strong>{email}</strong>. It works once and expires in an hour. Not there? Check spam, or{" "}
            <button type="button" className="font-semibold text-brand-600 underline dark:text-brand-300" onClick={() => setState("idle")}>
              try again
            </button>
            .
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <h2 className="font-display text-2xl tracking-tight">{title}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{intro}</p>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Your email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-800"
              placeholder="you@example.com"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
            <span>Email me cheap fares and travel tips (optional; unsubscribe anytime).</span>
          </label>
          {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
          <button
            type="submit"
            disabled={state === "sending"}
            className="w-full rounded-xl bg-brand-600 px-4 py-3 font-bold text-white shadow-md shadow-brand-600/20 hover:bg-brand-700 disabled:opacity-60"
          >
            {state === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
          <p className="text-xs text-slate-500">
            No password needed. We use your email to sign you in{marketing ? " and for the emails you asked for" : ""}, nothing else. By signing in you confirm
            you&apos;re 18 or over and agree to our <a href="/terms" className="underline">terms</a>; see our <a href="/privacy" className="underline">privacy notice</a>.
          </p>
        </form>
      )}
    </div>
  );
}
