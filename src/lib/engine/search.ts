// Search orchestrator: through tickets (A) + staged split tickets (B).

import { createHash, randomUUID } from "node:crypto";
import type { FlightProvider, SearchFilters } from "@/lib/providers/types";
import type { Store } from "@/lib/store";
import type {
  AppConfig,
  Badge,
  FlightLeg,
  GroundAccess,
  HubRoute,
  NormalisedItinerary,
  RouteOption,
  SearchRequest,
  SearchResponse,
} from "@/lib/types";
import { countPaid, createCallContext } from "./calls";
import { domesticDatesNeeded, hubsToSearch, pruneInternational } from "./prune";
import { aggregateCosts, assessBags, checkConnection, groundCost } from "./rules";
import { addDays, addMinutes, localDate, localHour, minutesBetween } from "./time";

const KEEP_PER_AXIS = 150;

/**
 * Trim the option list without hiding anything the ranking could pick: keep the
 * cheapest N, the fastest N, and every option no other option beats on both
 * price and time (so any position of the price-vs-time slider still works).
 */
export function selectForReturn<T extends { costs: { total: number }; totalMins: number }>(options: T[], perAxis = KEEP_PER_AXIS): T[] {
  const byCost = [...options].sort((a, b) => a.costs.total - b.costs.total || a.totalMins - b.totalMins);
  const keep = new Set<T>([...byCost.slice(0, perAxis), ...[...options].sort((a, b) => a.totalMins - b.totalMins).slice(0, perAxis)]);
  let bestMins = Infinity;
  for (const o of byCost) {
    if (o.totalMins < bestMins) {
      keep.add(o);
      bestMins = o.totalMins;
    }
  }
  return byCost.filter((o) => keep.has(o));
}

export function validateRequest(r: SearchRequest): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return "Pick a departure date.";
  if (!r.dest) return "Pick a destination.";
  if (!r.originArea) return "Pick where you're travelling from.";
  if (!(r.adults >= 1 && r.adults <= 9)) return "Adults must be between 1 and 9.";
  if (!(r.children >= 0 && r.children <= 8)) return "Children must be between 0 and 8.";
  if (!(r.bags >= 0 && r.bags <= 3)) return "Checked bags must be between 0 and 3 per person.";
  if (!(r.bagKg >= 0 && r.bagKg <= 32)) return "Bag weight must be between 0 and 32 kg.";
  if (r.minBufferMins != null && !(r.minBufferMins >= 60 && r.minBufferMins <= 720))
    return "Time to change flights must be between 1 and 12 hours.";
  if (r.flexDays !== 0 && r.flexDays !== 1) return "Flexibility must be 0 or ±1 day.";
  return null;
}

function routeBadges(option: Pick<RouteOption, "kind" | "legs" | "connection" | "costs">, bagsNeeded: boolean): Badge[] {
  const b: Badge[] = [];
  if (option.kind === "split") b.push("Separate tickets");
  if (bagsNeeded && option.legs.every((l) => l.bag.status === "included" || l.bag.status === "estimated"))
    b.push("Bags included");
  if (option.costs.bagsUnknown) b.push("Bag price unknown");
  if (option.connection?.terminalChange) b.push("Terminal change");
  if (option.connection?.overnight) b.push("Overnight");
  if (option.legs.some((l) => l.bag.excessRisk)) b.push("Excess baggage risk");
  if (option.legs.some((l) => !l.itinerary.price.verified)) b.push("Price not confirmed");
  return b;
}

export function buildOption(
  kind: RouteOption["kind"],
  legs: FlightLeg[],
  ground: GroundAccess,
  req: SearchRequest,
  ukArrivalMins: number,
  connection: RouteOption["connection"] = null,
): RouteOption {
  const pax = req.adults + req.children;
  const first = legs[0].itinerary;
  const last = legs[legs.length - 1].itinerary;
  const leaveHomeUtc = addMinutes(first.departUtc, -(ukArrivalMins + ground.duration_mins));
  const costs = aggregateCosts(groundCost(ground, pax), legs, connection?.hotelGbp ?? 0);
  const partial = { kind, legs, connection, costs };
  const asOf = legs.map((l) => l.itinerary.observedAt ?? l.itinerary.fetchedAt).sort()[0];
  return {
    id: createHash("sha1").update(legs.map((l) => l.itinerary.providerRef).join("+")).digest("hex").slice(0, 16),
    kind,
    ukAirport: first.origin,
    hub: kind === "split" ? first.dest : null,
    dest: last.dest,
    ground,
    legs,
    connection,
    costs,
    leaveHomeUtc,
    arriveUtc: last.arriveUtc,
    totalMins: minutesBetween(leaveHomeUtc, last.arriveUtc),
    badges: routeBadges(partial, req.bags > 0),
    priceAsOf: asOf,
  };
}

interface Deps {
  store: Store;
  provider: FlightProvider;
  now?: () => number;
}

export async function runSearch(req: SearchRequest, deps: Deps): Promise<SearchResponse> {
  const started = Date.now();
  const { store, provider } = deps;
  const config: AppConfig = await store.loadConfig();
  const s = config.settings;
  const ctx = createCallContext(store, s);
  const errors: string[] = [];
  const notes: string[] = [];
  const minBuffer = req.minBufferMins ?? s.min_buffer_mins;
  const allowOvernight = !!req.allowOvernight;
  const maxBuffer = allowOvernight ? s.overnight_max_buffer_mins : s.max_buffer_mins;
  const pax = { adults: req.adults, children: req.children };

  const tzOf = (iata: string) => config.airports.find((a) => a.iata === iata)?.tz ?? "Asia/Kolkata";
  const dates = req.flexDays === 1 ? [addDays(req.date, -1), req.date, addDays(req.date, 1)] : [req.date];

  const groundFor = new Map<string, GroundAccess>();
  for (const g of config.groundAccess.filter((g) => g.origin_area === req.originArea)) {
    const prev = groundFor.get(g.airport);
    if (!prev || groundCost(g, 1) < groundCost(prev, 1)) groundFor.set(g.airport, g);
  }
  const ukAirports = config.airports
    .filter((a) => a.role === "uk_origin" && a.enabled)
    .map((a) => a.iata)
    .filter((a) => !req.ukAirports?.length || req.ukAirports.includes(a));
  // Airports without a configured price still get searched; the user enters
  // their own train/cab prices on the results page.
  for (const a of ukAirports) {
    if (!groundFor.has(a))
      groundFor.set(a, { origin_area: req.originArea, airport: a, mode: "not set", cost_gbp: 0, per_person: false, duration_mins: 0, notes: "" });
  }
  const allHubs = config.airports.filter((a) => a.role === "india_hub" && a.enabled).map((a) => a.iata);
  const hubs = hubsToSearch(allHubs, req.dest, config.hubRoutes, s.hub_route_recheck_days);
  const skippedHubs = allHubs.filter((h) => !hubs.includes(h) && h !== req.dest);
  if (skippedHubs.length) notes.push(`Not searching ${skippedHubs.join(", ")}: no flights to ${req.dest} last time we checked.`);

  const safe = async (p: Promise<NormalisedItinerary[]>, what: string) => {
    try {
      return await p;
    } catch (err) {
      errors.push(`${what}: ${(err as Error).message}`);
      return null;
    }
  };

  // ----- Stage 1: through tickets + international legs, in parallel -----
  const throughFilters: SearchFilters = {
    ...pax,
    allowSelfTransfer: false,
    timeRange: { earliestDepartHour: req.earliestDepartHour ?? null, latestArriveHour: req.latestArriveHour ?? null },
  };
  const intlFilters: SearchFilters = {
    ...pax,
    allowSelfTransfer: false,
    timeRange: req.earliestDepartHour != null ? { earliestDepartHour: req.earliestDepartHour } : null,
  };

  const throughJobs = ukAirports.flatMap((o) =>
    dates.map((d) => safe(provider.searchOneWay(o, req.dest, d, throughFilters, ctx), `${o}→${req.dest} ${d}`)),
  );
  const intlJobs = ukAirports.flatMap((o) =>
    hubs.flatMap((h) => dates.map((d) => safe(provider.searchOneWay(o, h, d, intlFilters, ctx), `${o}→${h} ${d}`))),
  );
  const [throughRes, intlRes] = await Promise.all([Promise.all(throughJobs), Promise.all(intlJobs)]);

  const through = throughRes.flat().filter((i): i is NormalisedItinerary => !!i);
  const intl = intlRes.flat().filter((i): i is NormalisedItinerary => !!i && !i.selfTransfer && hubs.includes(i.dest));

  const options: RouteOption[] = [];
  for (const it of through) {
    if (it.selfTransfer) continue; // asked for protected connections only
    const ground = groundFor.get(it.origin);
    if (!ground) continue;
    const leg: FlightLeg = { routeType: "international", itinerary: it, bag: assessBags(it, "international", req, config) };
    options.push(buildOption("through", [leg], ground, req, s.uk_airport_arrival_mins));
  }

  // ----- Prune -----
  const cheapestThrough = through.length ? Math.min(...through.map((t) => t.price.totalGbp)) : null;
  const pruned = pruneInternational(intl, {
    cheapestThroughGbp: cheapestThrough,
    factor: s.prune_factor,
    maxPerGroup: s.max_intl_per_group,
  });
  if (pruned.droppedTooExpensive)
    notes.push(`${pruned.droppedTooExpensive} international flights dropped: over ${s.prune_factor}× the cheapest through ticket.`);

  // ----- Stage 2: domestic legs for surviving hubs -----
  const byHub = new Map<string, NormalisedItinerary[]>();
  for (const i of pruned.kept) byHub.set(i.dest, [...(byHub.get(i.dest) ?? []), i]);

  const hubRouteUpdates: HubRoute[] = [];
  const domesticByHub = new Map<string, NormalisedItinerary[]>();
  await Promise.all(
    [...byHub.entries()].map(async ([hub, arrivals]) => {
      const tz = tzOf(hub);
      const arrivalTimes = arrivals.map((a) => a.arriveUtc);
      const needed = domesticDatesNeeded(arrivalTimes, tz, minBuffer, maxBuffer);
      let anyFound = false;
      let allOk = true;
      let unfilteredSearched = false;
      const found: NormalisedItinerary[] = [];
      await Promise.all(
        needed.map(async (date) => {
          // Earliest useful departure hour on this date (saves processing, not calls).
          const starts = arrivalTimes.map((a) => addMinutes(a, minBuffer));
          const earliest = starts.some((t) => localDate(t, tz) < date)
            ? null
            : Math.min(...starts.filter((t) => localDate(t, tz) === date).map((t) => localHour(t, tz)));
          const earliestHour = earliest === null || !Number.isFinite(earliest) || earliest === 0 ? null : earliest;
          const filters: SearchFilters = {
            ...pax,
            allowSelfTransfer: false,
            maxStops: s.domestic_max_stops,
            timeRange:
              earliestHour != null || req.latestArriveHour != null
                ? { earliestDepartHour: earliestHour, latestArriveHour: req.latestArriveHour ?? null }
                : null,
          };
          if (!filters.timeRange) unfilteredSearched = true;
          const res = await safe(provider.searchOneWay(hub, req.dest, date, filters, ctx), `${hub}→${req.dest} ${date}`);
          if (res === null) allOk = false;
          else {
            if (res.length) anyFound = true;
            found.push(...res.filter((r) => !r.selfTransfer));
          }
        }),
      );
      domesticByHub.set(hub, found);
      if (anyFound || (allOk && unfilteredSearched)) {
        hubRouteUpdates.push({ hub, dest: req.dest, has_service: anyFound, last_checked_at: new Date().toISOString() });
      }
    }),
  );
  await store.upsertHubRoutes(hubRouteUpdates);

  // ----- Combine split tickets -----
  for (const [hub, arrivals] of byHub) {
    const doms = domesticByHub.get(hub) ?? [];
    const tz = tzOf(hub);
    for (const i of arrivals) {
      const ground = groundFor.get(i.origin);
      if (!ground) continue;
      const intlLeg: FlightLeg = { routeType: "international", itinerary: i, bag: assessBags(i, "international", req, config) };
      const combos: RouteOption[] = [];
      for (const d of doms) {
        const check = checkConnection(i, d, hub, tz, config, { minBufferMins: minBuffer, allowOvernight });
        if (!check.ok) continue;
        const domLeg: FlightLeg = { routeType: "domestic", itinerary: d, bag: assessBags(d, "domestic", req, config) };
        combos.push(buildOption("split", [intlLeg, domLeg], ground, req, s.uk_airport_arrival_mins, check.connection));
      }
      combos.sort((a, b) => a.costs.total - b.costs.total || a.totalMins - b.totalMins);
      const fastest = [...combos].sort((a, b) => a.totalMins - b.totalMins)[0];
      const chosen = new Set(combos.slice(0, s.max_domestic_per_intl));
      if (fastest) chosen.add(fastest);
      options.push(...chosen);
    }
  }

  // De-duplicate (identical itineraries can come back for neighbouring dates).
  const unique = [...new Map(options.map((o) => [o.id, o])).values()].sort(
    (a, b) => a.costs.total - b.costs.total || a.totalMins - b.totalMins,
  );

  const failed = ctx.log.filter((c) => !c.ok).length;
  if (!unique.length && !errors.length) errors.push("No flights found for these dates and settings.");
  const durationMs = Date.now() - started;
  const searchId = randomUUID();
  const paidCalls = countPaid(ctx.log);
  const cacheHits = ctx.log.filter((c) => c.cacheHit).length;
  await store.logSearch(
    { id: searchId, params: req, paid_calls: paidCalls, cache_hits: cacheHits, failed_calls: failed, result_count: unique.length, duration_ms: durationMs },
    ctx.log,
  );

  const airportTz: Record<string, string> = {};
  for (const a of config.airports) airportTz[a.iata] = a.tz;
  for (const o of unique) for (const l of o.legs) for (const seg of l.itinerary.segments) {
    if (seg.departTz && !airportTz[seg.origin]) airportTz[seg.origin] = seg.departTz;
    if (seg.arriveTz && !airportTz[seg.dest]) airportTz[seg.dest] = seg.arriveTz;
  }

  return {
    searchId,
    options: selectForReturn(unique),
    stats: { paidCalls, cacheHits, failedCalls: failed, durationMs, calls: ctx.log },
    errors: dedupeErrors(errors),
    notes,
    airportTz,
    storage: store.kind,
  };
}

/** Collapse identical provider errors ("IGNAV_API_KEY is not set" × 52) into one line. */
function dedupeErrors(errors: string[]): string[] {
  const byMsg = new Map<string, string[]>();
  for (const e of errors) {
    const idx = e.indexOf(": ");
    const [what, msg] = idx > 0 ? [e.slice(0, idx), e.slice(idx + 2)] : ["", e];
    byMsg.set(msg, [...(byMsg.get(msg) ?? []), what]);
  }
  return [...byMsg.entries()].map(([msg, whats]) =>
    whats.length > 3 ? `${msg} (${whats.length} searches)` : `${whats.filter(Boolean).join(", ")}: ${msg}`,
  );
}
