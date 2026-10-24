"use client";

import { useState } from "react";

// Small shared UI pieces: line icons (24px grid, stroke = currentColor) and the airline logo.

const PATHS = {
  plane: "M2.5 19h19M10 13.5 4.5 15 3 12.5l3-1L4 8l2-.6 4.2 3L15 9c1.5-.4 3.2-.5 4.2.2.6.5.3 1.4-.6 1.8L7.5 16",
  takeoff: "M2.5 19h19M3.6 13.4l2.5 2.2c.4.3 1 .4 1.5.2L20 11c.9-.4 1.2-1.3.7-2-.7-1-2.4-1.1-3.6-.6L13 10 6.5 6 5 6.7 9 11.2 5.5 12.6 4 11.4l-1 .5z",
  landing: "M2.5 19h19M4.5 9.5l.6 4.7c.1.5.4.9.9 1.1l12.8 3.5c1 .2 1.8-.2 2-1 .2-1.2-.8-2.6-2-3l-3.8-1.1-2.8-6.6-1.6-.4.2 5.6-3.6-1L6.8 9l-.9-.3z",
  swap: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
  calendar: "M8 3v3M16 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  bag: "M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M5 7h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM9 11v5M15 11v5",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 6 6 6-6 6",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  check: "m5 12 4.5 4.5L19 7",
  alert: "M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  info: "M12 16v-4M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  search: "m20 20-4.2-4.2M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  pin: "M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  home: "M3 11 12 4l9 7M5 10v10h14V10",
  train: "M8 3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM5 10h14M8 21l2-4M16 21l-2-4M8.5 14h.01M15.5 14h.01",
  shield: "M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6z",
  refund: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  x: "M6 6l12 12M18 6 6 18",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-5 w-5", strokeWidth = 1.8 }: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The airline's logo from Aviasales' logo CDN, falling back to its code in a coloured square. */
export function AirlineLogo({ code, size = 32, className = "" }: { code: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const hue = [...code].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  if (failed || !/^[A-Z0-9]{2}$/.test(code))
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white ${className}`}
        style={{ width: size, height: size, background: `hsl(${hue} 55% 45%)` }}
        aria-hidden="true"
      >
        {code}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external logo CDN; next/image would need remote config for no gain
    <img
      src={`https://pics.avs.io/${size * 2}/${size * 2}/${code}.png`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-md bg-white object-contain ${className}`}
    />
  );
}

export const card = "rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800";
