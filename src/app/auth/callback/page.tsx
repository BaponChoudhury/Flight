"use client";

import { useEffect, useState } from "react";
import { card } from "@/components/ui";

// Where the email link lands. Supabase puts the token in the URL fragment (never sent to a
// server by the browser), so this page reads it and hands it to /api/auth/session.
export default function AuthCallback() {
  const [error, setError] = useState("");
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const next = query.get("next") ?? "/refund-calculator";
    if (hash.get("error")) {
      setError(hash.get("error_code") === "otp_expired" ? "This sign-in link has expired. Please ask for a new one." : (hash.get("error_description") ?? "Sign-in failed.").replace(/\+/g, " "));
      return;
    }
    const token = hash.get("access_token");
    if (!token) {
      setError("This sign-in link is incomplete. Please ask for a new one.");
      return;
    }
    history.replaceState(null, "", window.location.pathname); // don't leave the token in the address bar
    fetch("/api/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: token, marketing: query.get("m") === "1", next }) })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Sign-in failed.");
        window.location.replace(d.next);
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className={`${card} p-6 text-center`}>
        {error ? (
          <>
            <p className="font-semibold">{error}</p>
            <a href="/refund-calculator" className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Get a new link</a>
          </>
        ) : (
          <p className="text-slate-600 dark:text-slate-400">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
