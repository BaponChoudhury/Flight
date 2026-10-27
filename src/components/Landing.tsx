"use client";

import type { AirportRecord } from "@/lib/airports-index";
import { Icon, type IconName } from "./ui";

/** Big diaspora routes, one tap to put them in the "To" box. */
const ROUTES: (Pick<AirportRecord, "code" | "city" | "name" | "country"> & { countryName: string; tint: string })[] = [
  { code: "DEL", city: "Delhi", name: "Indira Gandhi International Airport", country: "IN", countryName: "India", tint: "from-[#b4532a] to-[#7c2d3a]" },
  { code: "ATQ", city: "Amritsar", name: "Sri Guru Ram Dass Jee International Airport", country: "IN", countryName: "India", tint: "from-[#b7791f] to-[#8a3b12]" },
  { code: "BOM", city: "Mumbai", name: "Chhatrapati Shivaji Maharaj International Airport", country: "IN", countryName: "India", tint: "from-[#2f5fb3] to-[#1f2f6b]" },
  { code: "LHE", city: "Lahore", name: "Allama Iqbal International Airport", country: "PK", countryName: "Pakistan", tint: "from-[#1f7a5a] to-[#0f4a3c]" },
  { code: "ISB", city: "Islamabad", name: "Islamabad International Airport", country: "PK", countryName: "Pakistan", tint: "from-[#2d6a4f] to-[#163d30]" },
  { code: "DAC", city: "Dhaka", name: "Hazrat Shahjalal International Airport", country: "BD", countryName: "Bangladesh", tint: "from-[#16766f] to-[#0d4643]" },
  { code: "ZYL", city: "Sylhet", name: "Osmani International Airport", country: "BD", countryName: "Bangladesh", tint: "from-[#4d7a2a] to-[#24451a]" },
  { code: "CMB", city: "Colombo", name: "Bandaranaike International Airport", country: "LK", countryName: "Sri Lanka", tint: "from-[#1b6f9a] to-[#123f63]" },
];

export function PopularRoutes({ onPick }: { onPick: (a: AirportRecord) => void }) {
  return (
    <section aria-labelledby="popular" className="mt-14">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-500">Popular routes</p>
          <h2 id="popular" className="mt-1 font-display text-2xl tracking-tight sm:text-3xl">Where are you flying home to?</h2>
        </div>
        <p className="hidden max-w-xs text-right text-sm text-slate-500 sm:block dark:text-slate-400">Tap a city to search from your nearest UK airports.</p>
      </div>
      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ROUTES.map((r) => (
          <li key={r.code}>
            <button
              type="button"
              onClick={() => onPick({ ...r, lat: 0, lon: 0 })}
              className="group relative flex h-28 w-full flex-col justify-end overflow-hidden rounded-2xl p-4 text-left text-white shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-lg sm:h-32"
            >
              <span className={`absolute inset-0 bg-gradient-to-br ${r.tint}`} />
              <span className="absolute right-3 top-2 font-display text-4xl font-semibold italic tracking-tight text-white/20 transition group-hover:text-white/35 sm:text-5xl">{r.code}</span>
              <span className="relative text-[11px] font-semibold uppercase tracking-wider text-white/80">{r.countryName}</span>
              <span className="relative flex items-center justify-between gap-2">
                <span className="font-display text-xl font-semibold leading-tight">{r.city}</span>
                <Icon name="arrowRight" className="h-4 w-4 shrink-0 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" strokeWidth={2.2} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const WHY: [IconName, string, string][] = [
  ["sparkle", "Split tickets other sites miss", "For smaller Indian cities we pair an international flight with a separate domestic one, often cheaper than a single ticket."],
  ["shield", "Every connection checked", "Enough time to change, terminals and bag re-checks are checked before a route is shown to you."],
  ["home", "The real door-to-door cost", "Add the train, coach or cab to each airport and see which one really works out cheapest."],
];

export function WhyUs() {
  return (
    <section aria-labelledby="why" className="mt-16">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-500">Why travellers use us</p>
      <h2 id="why" className="mt-1 font-display text-2xl tracking-tight sm:text-3xl">More than the cheapest fare</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {WHY.map(([icon, title, text]) => (
          <div key={title} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
              <Icon name={icon} />
            </span>
            <h3 className="mt-3 font-semibold">{title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Decorative flight path across the hero, from the UK (left) towards South Asia (right). */
export function FlightArc() {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-x-0 top-6 hidden h-64 w-full lg:block" viewBox="0 0 1200 260" preserveAspectRatio="xMidYMid meet" fill="none">
      <path d="M640 210 C 820 40, 1000 30, 1150 120" stroke="url(#arc)" strokeWidth="2" strokeDasharray="2 10" strokeLinecap="round" />
      <circle cx="640" cy="210" r="4" fill="#93b4fd" />
      <circle cx="1150" cy="120" r="5" fill="#fbcf6b" />
      <circle cx="1150" cy="120" r="14" stroke="#fbcf6b" strokeOpacity="0.35" />
      <defs>
        <linearGradient id="arc" x1="640" x2="1150" y1="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#93b4fd" stopOpacity="0.2" />
          <stop offset="1" stopColor="#fbcf6b" stopOpacity="0.9" />
        </linearGradient>
      </defs>
    </svg>
  );
}
