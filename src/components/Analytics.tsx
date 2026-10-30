"use client";

import Script from "next/script";
import Link from "next/link";
import { useEffect, useState } from "react";

// Google Analytics 4. It sets tracking cookies, so under UK PECR it only loads after the visitor
// accepts; until then (or if they reject) no request goes to Google at all.
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || "G-96PSQ9Q9EK";
const KEY = "cookie-consent"; // "granted" | "denied"
const OPEN_EVENT = "open-cookie-settings";

type Choice = "granted" | "denied" | null;

function readChoice(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

/** Removes Google Analytics cookies after consent is withdrawn. */
function clearGaCookies() {
  const host = location.hostname;
  const domains = ["", host, `.${host}`, `.${host.split(".").slice(-2).join(".")}`];
  for (const name of document.cookie.split(";").map((c) => c.split("=")[0].trim()).filter((n) => n === "_ga" || n.startsWith("_ga_") || n === "_gid")) {
    for (const d of domains) document.cookie = `${name}=; Max-Age=0; path=/${d ? `; domain=${d}` : ""}`;
  }
}

export function Analytics() {
  const [choice, setChoice] = useState<Choice>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const c = readChoice();
    setChoice(c);
    setOpen(c === null);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, reopen);
    return () => window.removeEventListener(OPEN_EVENT, reopen);
  }, []);

  function decide(c: "granted" | "denied") {
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* storage unavailable: the banner shows again next visit */
    }
    setOpen(false);
    if (c === "denied" && choice === "granted") {
      // Google's script is already running: clear its cookies and reload without it.
      clearGaCookies();
      location.reload();
      return;
    }
    setChoice(c);
  }

  return (
    <>
      {choice === "granted" && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
          </Script>
        </>
      )}
      {open && (
        <div role="dialog" aria-label="Cookie choices" className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl bg-white p-4 text-sm shadow-2xl ring-1 ring-slate-200 sm:flex-row sm:items-center dark:bg-slate-900 dark:ring-slate-700">
            <p className="flex-1 text-slate-700 dark:text-slate-300">
              We&apos;d like to use Google Analytics cookies to see how people use the site, so we can improve it. They&apos;re optional and only set if you
              accept. <Link href="/cookies" className="font-semibold text-brand-600 underline dark:text-brand-300">Cookie policy</Link>
            </p>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => decide("denied")} className="flex-1 rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50 sm:flex-none dark:border-slate-600 dark:hover:bg-slate-800">
                Reject
              </button>
              <button type="button" onClick={() => decide("granted")} className="flex-1 rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700 sm:flex-none">
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Footer link that reopens the banner so visitors can change their mind. */
export function CookieSettingsButton() {
  return (
    <button type="button" className="hover:underline" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
      Cookie settings
    </button>
  );
}
