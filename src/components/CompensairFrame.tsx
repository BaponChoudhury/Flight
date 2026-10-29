"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./ui";

const KEY = "compensair-consent";

/**
 * Compensair's form sets its own (third-party) cookies, so it only loads once the visitor asks for
 * it (UK PECR). The choice is remembered on this device.
 */
export function CompensairFrame({ src, name }: { src: string; name: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "1") setShow(true);
    } catch {
      /* storage unavailable */
    }
  }, []);
  function load() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* storage unavailable */
    }
    setShow(true);
  }
  if (show) return <iframe src={src} name={name} title="Compensair claim form" className="block h-[775px] w-full border-0" />;
  return (
    <div className="flex min-h-[22rem] flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
        <Icon name="shield" />
      </span>
      <h2 className="text-lg font-bold">Check your flight with Compensair</h2>
      <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">
        The claim form is provided by our partner Compensair and loads from their website, which may set its own cookies. What you enter goes to
        Compensair under their privacy policy.
      </p>
      <button type="button" onClick={load} className="rounded-xl bg-brand-600 px-5 py-2.5 font-bold text-white shadow-md shadow-brand-600/20 hover:bg-brand-700">
        Show the claim form
      </button>
      <p className="text-xs text-slate-500">
        See our <Link href="/cookies" className="underline">cookie policy</Link>.
      </p>
    </div>
  );
}
