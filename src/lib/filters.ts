// Results-page filters: worked out from the options already returned, so no new search.

import { airlineName } from "@/lib/airline-names";
import { localHour } from "@/lib/engine/time";
import type { NormalisedSegment, RouteOption } from "@/lib/types";

export type TimeOfDay = "night" | "morning" | "afternoon" | "evening";
export type TicketType = "one" | "separate";

export const TIME_OF_DAY: { id: TimeOfDay; label: string; from: number; to: number }[] = [
  { id: "morning", label: "Morning (5am–noon)", from: 5, to: 12 },
  { id: "afternoon", label: "Afternoon (noon–6pm)", from: 12, to: 18 },
  { id: "evening", label: "Evening (6pm–midnight)", from: 18, to: 24 },
  { id: "night", label: "Night (midnight–5am)", from: 0, to: 5 },
];

export interface Filters {
  refundableOnly: boolean;
  /** Empty = any. */
  ticketTypes: TicketType[];
  /** Most stops on the way out; null = any. */
  maxStops: number | null;
  maxPrice: number | null;
  maxMins: number | null;
  departTimes: TimeOfDay[];
  arriveTimes: TimeOfDay[];
  /** Codes the user has unticked: options using any of them are hidden. */
  hiddenUkAirports: string[];
  hiddenAirlines: string[];
  hiddenVia: string[];
  bagsConfirmed: boolean;
  noTerminalChange: boolean;
  noOvernight: boolean;
  noExcessBaggage: boolean;
}

export const NO_FILTERS: Filters = {
  refundableOnly: false,
  ticketTypes: [],
  maxStops: null,
  maxPrice: null,
  maxMins: null,
  departTimes: [],
  arriveTimes: [],
  hiddenUkAirports: [],
  hiddenAirlines: [],
  hiddenVia: [],
  bagsConfirmed: false,
  noTerminalChange: false,
  noOvernight: false,
  noExcessBaggage: false,
};

/** How many filters differ from "show everything" (for the "Filters (3)" button). */
export function activeCount(f: Filters): number {
  return (Object.keys(NO_FILTERS) as (keyof Filters)[]).filter((k) => JSON.stringify(f[k]) !== JSON.stringify(NO_FILTERS[k])).length;
}

const outSegments = (o: RouteOption): NormalisedSegment[] => o.legs.flatMap((l) => l.itinerary.segments);
const allSegments = (o: RouteOption): NormalisedSegment[] => [...o.legs, ...(o.back?.legs ?? [])].flatMap((l) => l.itinerary.segments);

export const ticketType = (o: RouteOption): TicketType => (o.badges.includes("Separate tickets") ? "separate" : "one");
export const stopsOf = (o: RouteOption): number => outSegments(o).length - 1;
export const airlinesOf = (o: RouteOption): string[] => [...new Set(allSegments(o).map((s) => s.carrier ?? "??"))];
/** Airports where the trip changes plane, both ways. */
export const viaOf = (o: RouteOption): string[] => {
  const legs = [o.legs, o.back?.legs ?? []].map((ls) => ls.flatMap((l) => l.itinerary.segments));
  return [...new Set(legs.flatMap((segs) => segs.slice(1).map((s) => s.origin)))];
};

function timeOfDay(utc: string, tz: string): TimeOfDay {
  const h = localHour(utc, tz);
  return TIME_OF_DAY.find((t) => h >= t.from && h < t.to)!.id;
}

const departTime = (o: RouteOption, tz: Record<string, string>) => {
  const s = outSegments(o)[0];
  return timeOfDay(s.departUtc, s.departTz ?? tz[s.origin] ?? "Europe/London");
};
const arriveTime = (o: RouteOption, tz: Record<string, string>) => {
  const segs = outSegments(o);
  const s = segs[segs.length - 1];
  return timeOfDay(s.arriveUtc, s.arriveTz ?? tz[s.dest] ?? "Asia/Kolkata");
};

export function applyFilters(options: RouteOption[], f: Filters, tz: Record<string, string>): RouteOption[] {
  return options.filter(
    (o) =>
      (!f.ticketTypes.length || f.ticketTypes.includes(ticketType(o))) &&
      (f.maxStops == null || stopsOf(o) <= f.maxStops) &&
      (f.maxPrice == null || o.costs.total <= f.maxPrice) &&
      (f.maxMins == null || o.totalMins <= f.maxMins) &&
      (!f.departTimes.length || f.departTimes.includes(departTime(o, tz))) &&
      (!f.arriveTimes.length || f.arriveTimes.includes(arriveTime(o, tz))) &&
      !f.hiddenUkAirports.includes(o.ukAirport) &&
      !airlinesOf(o).some((a) => f.hiddenAirlines.includes(a)) &&
      !viaOf(o).some((v) => f.hiddenVia.includes(v)) &&
      (!f.bagsConfirmed || !o.costs.bagsUnknown) &&
      (!f.noTerminalChange || !o.badges.includes("Terminal change")) &&
      (!f.noOvernight || !o.badges.includes("Overnight")) &&
      (!f.noExcessBaggage || !o.badges.includes("Excess baggage risk")),
  );
}

export interface Facet {
  code: string;
  label: string;
  count: number;
  /** Cheapest option using it. */
  fromGbp: number;
}

export interface Facets {
  ukAirports: Facet[];
  airlines: Facet[];
  via: Facet[];
  stops: number[];
  price: { min: number; max: number };
  mins: { min: number; max: number };
  hasSeparate: boolean;
  hasOne: boolean;
}

function facet(options: RouteOption[], codesOf: (o: RouteOption) => string[], labelOf: (code: string) => string): Facet[] {
  const m = new Map<string, Facet>();
  for (const o of options)
    for (const code of codesOf(o)) {
      const f = m.get(code) ?? { code, label: labelOf(code), count: 0, fromGbp: Infinity };
      f.count++;
      f.fromGbp = Math.min(f.fromGbp, o.costs.total);
      m.set(code, f);
    }
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The choices each filter offers, from the options before filtering. */
export function facetsOf(options: RouteOption[]): Facets {
  const names = new Map<string, string>();
  for (const o of options)
    for (const l of [...o.legs, ...(o.back?.legs ?? [])])
      for (const s of l.itinerary.segments)
        if (s.carrier && !names.has(s.carrier)) names.set(s.carrier, airlineName(s.carrier, l.itinerary.carrier === s.carrier ? l.itinerary.carrierName : null));
  const prices = options.map((o) => o.costs.total);
  const mins = options.map((o) => o.totalMins);
  return {
    ukAirports: facet(options, (o) => [o.ukAirport], (c) => c),
    airlines: facet(options, airlinesOf, (c) => (names.has(c) && names.get(c) !== c ? `${names.get(c)} (${c})` : c)),
    via: facet(options, viaOf, (c) => c),
    stops: [...new Set(options.map(stopsOf))].sort((a, b) => a - b),
    price: { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) },
    mins: { min: Math.min(...mins), max: Math.max(...mins) },
    hasSeparate: options.some((o) => ticketType(o) === "separate"),
    hasOne: options.some((o) => ticketType(o) === "one"),
  };
}
