// Stage-1 pruning: decide which international legs are worth a domestic search.

import type { HubRoute, NormalisedItinerary } from "@/lib/types";
import { addMinutes, localDate } from "./time";

export interface PruneOptions {
  /** Cheapest through-ticket fare (GBP, whole party), if any were found. */
  cheapestThroughGbp: number | null;
  factor: number;
  /** Keep at most this many per (UK origin, hub) group by price, plus the 2 fastest. */
  maxPerGroup: number;
}

export interface PruneResult {
  kept: NormalisedItinerary[];
  droppedTooExpensive: number;
  droppedByCap: number;
}

export function pruneInternational(intl: NormalisedItinerary[], opts: PruneOptions): PruneResult {
  const limit = opts.cheapestThroughGbp != null ? opts.cheapestThroughGbp * opts.factor : Infinity;
  const affordable = intl.filter((i) => i.price.totalGbp <= limit);
  const droppedTooExpensive = intl.length - affordable.length;

  const groups = new Map<string, NormalisedItinerary[]>();
  for (const i of affordable) {
    const k = `${i.origin}|${i.dest}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const kept: NormalisedItinerary[] = [];
  for (const list of groups.values()) {
    const byPrice = [...list].sort((a, b) => a.price.totalGbp - b.price.totalGbp).slice(0, opts.maxPerGroup);
    const byTime = [...list].sort((a, b) => a.durationMins - b.durationMins).slice(0, 2);
    const chosen = new Set([...byPrice, ...byTime]);
    kept.push(...list.filter((i) => chosen.has(i)));
  }
  return { kept, droppedTooExpensive, droppedByCap: affordable.length - kept.length };
}

/**
 * Hub-local dates that need a domestic search so every kept international
 * arrival can connect: its connection window [arrival + min, arrival + max],
 * limited to the arrival date and the day after (as specified).
 */
export function domesticDatesNeeded(
  arrivalsUtc: string[],
  hubTz: string,
  minBufferMins: number,
  maxBufferMins: number,
): string[] {
  const dates = new Set<string>();
  for (const a of arrivalsUtc) {
    const arrDate = localDate(a, hubTz);
    const nextDate = localDate(addMinutes(a, 24 * 60), hubTz);
    const first = localDate(addMinutes(a, minBufferMins), hubTz);
    const last = localDate(addMinutes(a, maxBufferMins), hubTz);
    for (const d of [arrDate, nextDate]) if (d >= first && d <= last) dates.add(d);
  }
  return [...dates].sort();
}

/** Hubs worth searching for `dest`: anything not known to lack service (or due a recheck). */
export function hubsToSearch(hubs: string[], dest: string, routes: HubRoute[], recheckDays: number, now = Date.now()): string[] {
  return hubs.filter((hub) => {
    if (hub === dest) return false;
    const r = routes.find((x) => x.hub === hub && x.dest === dest);
    if (!r || r.has_service) return true;
    return now - Date.parse(r.last_checked_at) > recheckDays * 86_400_000;
  });
}
