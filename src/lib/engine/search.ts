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
import { aggregateCosts, assessBags, checkConnection, groundCost, type ConnectionCheck } from "./rules";
import { addDays, addMinutes, localDate, localHour, minutesBetween } from "./time";
import { knownTz } from "@/lib/config/places";

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
  if (!/^[A-Z]{3}$/.test(r.dest ?? "")) return "Pick a destination airport in India.";
  if (!r.originArea?.trim() && !r.ukAirports?.length) return "Enter where you're travelling from, or pick departure airports.";
  if (r.ukAirports != null && (!r.ukAirports.length || r.ukAirports.length > 5 || r.ukAirports.some((a) => !/^[A-Z]{3}$/.test(a))))
    return "Pick between 1 and 5 UK airports.";
  if (!(r.adults >= 1 && r.adults <= 9)) return "Adults must be between 1 and 9.";
  if (!(r.children >= 0 && r.children <= 8)) return "Children must be between 0 and 8.";
  const infants = r.infants ?? 0;
  if (!(infants >= 0 && infants <= r.adults)) return "Each infant needs an adult (at most one infant per adult).";
  if (!(r.bags >= 0 && r.bags <= 3)) return "Checked bags must be between 0 and 3 per person.";
  if (r.bagKg != null && !(r.bagKg >= 0 && r.bagKg <= 32)) return "Bag weight must be between 0 and 32 kg.";
  if (r.minBufferMins != null && !(r.minBufferMins >= 60 && r.minBufferMins <= 720))
    return "Time to change flights must be between 1 and 12 hours.";
  if (r.flexDays !== 0 && r.flexDays !== 1) return "Flexibility must be 0 or ±1 day.";
  if (r.returnDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.returnDate)) return "Pick a return date.";
    if (r.returnDate <= addDays(r.date, r.flexDays)) return "The return date must be after the departure date.";
    if (r.returnDate > addDays(r.date, 330)) return "The return date must be within 330 days of departure.";
  }
  return null;
}

/** Every flight leg of an option, outbound then return. */
export function allLegs(o: Pick<RouteOption, "legs" | "back">): FlightLeg[] {
  return o.back ? [...o.legs, ...o.back.legs] : o.legs;
}

function routeBadges(option: Pick<RouteOption, "kind" | "legs" | "connection" | "costs" | "back">, bagsNeeded: boolean): Badge[] {
  const b: Badge[] = [];
  const legs = allLegs(option);
  const connections = [option.connection, option.back?.connection ?? null];
  if (option.kind === "split") b.push("Separate tickets");
  if (bagsNeeded && legs.every((l) => l.bag.status === "included" || l.bag.status === "estimated")) b.push("Bags included");
  if (option.costs.bagsUnknown) b.push("Bag price unknown");
  if (connections.some((c) => c?.terminalChange)) b.push("Terminal change");
  if (connections.some((c) => c?.overnight)) b.push("Overnight");
  if (legs.some((l) => l.bag.excessRisk)) b.push("Excess baggage risk");
  if (legs.some((l) => !l.itinerary.price.verified)) b.push("Price not confirmed");
  return b;
}

export interface ReturnPart {
  legs: FlightLeg[];
  connection: RouteOption["connection"];
  ukExitMins: number;
}

export function buildOption(
  kind: RouteOption["kind"],
  legs: FlightLeg[],
  ground: GroundAccess,
  req: SearchRequest,
  ukArrivalMins: number,
  connection: RouteOption["connection"] = null,
  ret: ReturnPart | null = null,
): RouteOption {
  const pax = req.adults + req.children;
  const first = legs[0].itinerary;
  const last = legs[legs.length - 1].itinerary;
  const leaveHomeUtc = addMinutes(first.departUtc, -(ukArrivalMins + ground.duration_mins));
  const outMins = minutesBetween(leaveHomeUtc, last.arriveUtc);
  let back: RouteOption["back"] = null;
  if (ret) {
    const leaveDestUtc = ret.legs[0].itinerary.departUtc;
    const arriveUkUtc = ret.legs[ret.legs.length - 1].itinerary.arriveUtc;
    const arriveHomeUtc = addMinutes(arriveUkUtc, ret.ukExitMins + ground.duration_mins);
    back = { legs: ret.legs, connection: ret.connection, leaveDestUtc, arriveUkUtc, arriveHomeUtc, totalMins: minutesBetween(leaveDestUtc, arriveHomeUtc) };
  }
  const flights = back ? [...legs, ...back.legs] : legs;
  const hotel = (connection?.hotelGbp ?? 0) + (back?.connection?.hotelGbp ?? 0);
  const costs = aggregateCosts(groundCost(ground, pax) * (back ? 2 : 1), flights, hotel);
  const asOf = flights.map((l) => l.itinerary.observedAt ?? l.itinerary.fetchedAt).sort()[0];
  return {
    id: createHash("sha1").update(flights.map((l) => `${l.itinerary.providerRef}@${l.itinerary.departUtc}`).join("+")).digest("hex").slice(0, 16),
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
    outMins,
    back,
    totalMins: outMins + (back?.totalMins ?? 0),
    badges: routeBadges({ kind, legs, connection, costs, back }, req.bags > 0),
    priceAsOf: asOf,
  };
}

const INDIA_TZ = "Asia/Kolkata";

function sliceItinerary(it: NormalisedItinerary, from: number, to: number, priced: boolean): NormalisedItinerary {
  const segments = it.segments.slice(from, to);
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    ...it,
    origin: first.origin,
    dest: last.dest,
    departUtc: first.departUtc,
    arriveUtc: last.arriveUtc,
    durationMins: minutesBetween(first.departUtc, last.arriveUtc),
    carrier: first.carrier,
    carrierName: first.carrierName,
    segments,
    price: priced ? it.price : { ...it.price, amount: 0, totalGbp: 0 },
    // The bag-inclusive search applies to the whole itinerary, so every part keeps Ignav's bag count.
    baggage: it.baggage,
  };
}

/**
 * In a self-transfer itinerary we don't know where the ticket breaks are, so
 * treat every change of airline as one and require the minimum buffer there.
 */
export function airlineChangesHaveBuffer(it: NormalisedItinerary, minBufferMins: number): boolean {
  return it.segments.every((seg, i) => {
    const next = it.segments[i + 1];
    if (!next || next.carrier === seg.carrier) return true;
    return minutesBetween(seg.arriveUtc, next.departUtc) >= minBufferMins;
  });
}

/**
 * Split an Ignav self-transfer itinerary where it first lands in India and
 * carries on within India: that's where the ticket change (and bag re-check)
 * happens. Returns null when there's no such point.
 */
export function splitAtIndiaEntry(
  it: NormalisedItinerary,
  tzOfAirport: (iata: string) => string | null,
): [NormalisedItinerary, NormalisedItinerary] | null {
  const tz = (iata: string, segTz: string | null) => segTz ?? tzOfAirport(iata);
  for (let i = 0; i < it.segments.length - 1; i++) {
    const seg = it.segments[i];
    const next = it.segments[i + 1];
    const intoIndia = tz(seg.origin, seg.departTz) !== INDIA_TZ && tz(seg.dest, seg.arriveTz) === INDIA_TZ;
    if (intoIndia && next.origin === seg.dest) {
      return [sliceItinerary(it, 0, i + 1, true), sliceItinerary(it, i + 1, it.segments.length, false)];
    }
  }
  return null;
}

/**
 * Mirror of splitAtIndiaEntry for the way home: split where a domestic flight
 * hands over to one leaving India. Both parts are price-included (the return
 * fare is on the outbound).
 */
export function splitAtIndiaExit(
  it: NormalisedItinerary,
  tzOfAirport: (iata: string) => string | null,
): [NormalisedItinerary, NormalisedItinerary] | null {
  const tz = (iata: string, segTz: string | null) => segTz ?? tzOfAirport(iata);
  for (let i = 1; i < it.segments.length; i++) {
    const prev = it.segments[i - 1];
    const seg = it.segments[i];
    const outOfIndia = tz(seg.origin, seg.departTz) === INDIA_TZ && tz(seg.dest, seg.arriveTz) !== INDIA_TZ;
    const prevDomestic = tz(prev.origin, prev.departTz) === INDIA_TZ;
    if (outOfIndia && prevDomestic && prev.dest === seg.origin) {
      return [sliceItinerary(it, 0, i, false), sliceItinerary(it, i, it.segments.length, false)];
    }
  }
  return null;
}

/** An international option: one-way (`back` null) or a return fare. */
type Candidate = { out: NormalisedItinerary; back: NormalisedItinerary | null };

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
  // Every search asks for fares that include the user's checked bags, so prices are bag-inclusive.
  const pax = { adults: req.adults, children: req.children, infants: req.infants ?? 0, minCheckedBags: req.bags > 0 ? req.bags : null };

  const tzOf = (iata: string) => config.airports.find((a) => a.iata === iata)?.tz ?? knownTz(iata) ?? "Asia/Kolkata";
  const dates = req.flexDays === 1 ? [addDays(req.date, -1), req.date, addDays(req.date, 1)] : [req.date];

  // Admin defaults for this home area, if any ("Stafford" matches "Stafford, Staffordshire").
  const area = (req.originArea ?? "").trim().toLowerCase();
  const configured = new Map<string, GroundAccess>();
  for (const g of config.groundAccess.filter((g) => area && area.startsWith(g.origin_area.toLowerCase()))) {
    const prev = configured.get(g.airport);
    if (!prev || groundCost(g, 1) < groundCost(prev, 1)) configured.set(g.airport, g);
  }
  // Every departure airport gets a ground entry (LON results come back as LHR/LGW/STN…);
  // without a configured one the user enters their own train/cab prices on the results page.
  const groundFor = {
    get: (airport: string): GroundAccess =>
      configured.get(airport) ?? { origin_area: req.originArea, airport, mode: "not set", cost_gbp: 0, per_person: false, duration_mins: 0, notes: "" },
  };
  const ukAirports = req.ukAirports?.length
    ? req.ukAirports
    : config.airports.filter((a) => a.role === "uk_origin" && a.enabled).map((a) => a.iata);
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
  // Self-transfer itineraries are allowed for through tickets: Ignav's own
  // separate-ticket combinations come back in the same call, so they cost nothing extra.
  // With a return date, both searches use Ignav's return fares (same number of calls).
  const returnDate = req.returnDate || null;
  const throughFilters: SearchFilters = {
    ...pax,
    allowSelfTransfer: true,
    timeRange: { earliestDepartHour: req.earliestDepartHour ?? null, latestArriveHour: req.latestArriveHour ?? null },
  };
  const intlFilters: SearchFilters = {
    ...pax,
    allowSelfTransfer: false,
    timeRange: req.earliestDepartHour != null ? { earliestDepartHour: req.earliestDepartHour } : null,
  };
  const searchIntl = async (o: string, d: string, date: string, f: SearchFilters): Promise<Candidate[] | null> => {
    if (!returnDate) {
      const r = await safe(provider.searchOneWay(o, d, date, f, ctx), `${o}→${d} ${date}`);
      return r && r.map((out) => ({ out, back: null }));
    }
    try {
      return await provider.searchRoundTrip(o, d, date, returnDate, f, ctx);
    } catch (err) {
      errors.push(`${o}⇄${d} ${date}/${returnDate}: ${(err as Error).message}`);
      return null;
    }
  };

  // With bags, the bag filter makes Ignav drop protected through tickets it has no bag
  // data for (e.g. LHR–DEL–GAU on Air India), so through tickets are also searched
  // without it (+1 call per UK airport). Those keep "bag price unknown" — never a guessed fee.
  const throughVariants = pax.minCheckedBags ? [throughFilters, { ...throughFilters, minCheckedBags: null }] : [throughFilters];
  const throughJobs = ukAirports.flatMap((o) => dates.flatMap((d) => throughVariants.map((f) => searchIntl(o, req.dest, d, f))));
  const intlJobs = ukAirports.flatMap((o) => hubs.flatMap((h) => dates.map((d) => searchIntl(o, h, d, intlFilters))));
  const [throughRes, intlRes] = await Promise.all([Promise.all(throughJobs), Promise.all(intlJobs)]);

  const through = throughRes.flat().filter((c): c is Candidate => !!c);
  const intl = intlRes.flat().filter((c): c is Candidate => !!c && !c.out.selfTransfer && !c.back?.selfTransfer && hubs.includes(c.out.dest));
  const bagLeg = (it: NormalisedItinerary, routeType: FlightLeg["routeType"], bundled = false): FlightLeg => ({
    routeType,
    itinerary: it,
    bag: assessBags(it, routeType, req, config),
    ...(bundled ? { bundled } : {}),
  });
  const tzLookup = (iata: string) => config.airports.find((a) => a.iata === iata)?.tz ?? knownTz(iata);
  const connOpts = { minBufferMins: minBuffer, allowOvernight };

  const options: RouteOption[] = [];
  let selfTransferRejected = 0;
  for (const c of through) {
    const ground = groundFor.get(c.out.origin);
    const selfTransfer = c.out.selfTransfer || !!c.back?.selfTransfer;
    if (!selfTransfer) {
      const ret = c.back ? { legs: [bagLeg(c.back, "international", true)], connection: null, ukExitMins: s.uk_arrival_exit_mins } : null;
      options.push(buildOption("through", [bagLeg(c.out, "international")], ground, req, s.uk_airport_arrival_mins, null, ret));
      continue;
    }
    // Ignav's own separate-ticket combination: apply the same connection rules as ours.
    const parts = splitAtIndiaEntry(c.out, tzLookup);
    const check = parts && airlineChangesHaveBuffer(c.out, minBuffer) ? checkConnection(parts[0], parts[1], parts[0].dest, tzOf(parts[0].dest), config, connOpts) : null;
    if (!parts || !check?.ok) {
      selfTransferRejected++;
      continue;
    }
    let ret: ReturnPart | null = null;
    if (c.back) {
      const backParts = splitAtIndiaExit(c.back, tzLookup);
      const hub = backParts?.[0].dest;
      const backCheck = backParts && hub && airlineChangesHaveBuffer(c.back, minBuffer)
        ? checkConnection(backParts[0], backParts[1], hub, tzOf(hub), config, connOpts, "back")
        : null;
      if (!backParts || !backCheck?.ok) {
        selfTransferRejected++;
        continue;
      }
      ret = { legs: [bagLeg(backParts[0], "domestic", true), bagLeg(backParts[1], "international", true)], connection: backCheck.connection, ukExitMins: s.uk_arrival_exit_mins };
    }
    options.push(buildOption("split", [bagLeg(parts[0], "international"), bagLeg(parts[1], "domestic", true)], ground, req, s.uk_airport_arrival_mins, check.connection, ret));
  }
  if (selfTransferRejected)
    notes.push(`${selfTransferRejected} ready-made separate-ticket combinations dropped: connection too short or too long for your settings.`);

  // ----- Prune (on the outbound flight; a return fare's price sits on it) -----
  const cheapestThrough = through.length ? Math.min(...through.map((t) => t.out.price.totalGbp)) : null;
  const candidateOf = new Map(intl.map((c) => [c.out, c]));
  const pruned = pruneInternational(intl.map((c) => c.out), {
    cheapestThroughGbp: cheapestThrough,
    factor: s.prune_factor,
    maxPerGroup: s.max_intl_per_group,
  });
  if (pruned.droppedTooExpensive)
    notes.push(`${pruned.droppedTooExpensive} international flights dropped: over ${s.prune_factor}× the cheapest through ticket.`);

  // ----- Stage 2: domestic legs for surviving hubs -----
  const byHub = new Map<string, Candidate[]>();
  for (const out of pruned.kept) byHub.set(out.dest, [...(byHub.get(out.dest) ?? []), candidateOf.get(out)!]);

  const hubRouteUpdates: HubRoute[] = [];
  const domesticByHub = new Map<string, NormalisedItinerary[]>();
  const returnDomesticByHub = new Map<string, NormalisedItinerary[]>();
  await Promise.all(
    [...byHub.entries()].map(async ([hub, cands]) => {
      const tz = tzOf(hub);
      const arrivalTimes = cands.map((c) => c.out.arriveUtc);
      const needed = domesticDatesNeeded(arrivalTimes, tz, minBuffer, maxBuffer);
      let anyFound = false;
      let allOk = true;
      let unfilteredSearched = false;
      const found: NormalisedItinerary[] = [];
      const outbound = needed.map(async (date) => {
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
      });
      // Way home: destination → hub on the return date (one call per hub).
      const homeward = returnDate
        ? (async () => {
            const filters: SearchFilters = { ...pax, allowSelfTransfer: false, maxStops: s.domestic_max_stops };
            const res = await safe(provider.searchOneWay(req.dest, hub, returnDate, filters, ctx), `${req.dest}→${hub} ${returnDate}`);
            returnDomesticByHub.set(hub, (res ?? []).filter((r) => !r.selfTransfer));
          })()
        : Promise.resolve();
      await Promise.all([...outbound, homeward]);
      domesticByHub.set(hub, found);
      if (anyFound || (allOk && unfilteredSearched)) {
        hubRouteUpdates.push({ hub, dest: req.dest, has_service: anyFound, last_checked_at: new Date().toISOString() });
      }
    }),
  );
  await store.upsertHubRoutes(hubRouteUpdates);

  // ----- Combine split tickets -----
  const pick = <T>(list: T[], cheapest: number, alsoBest: ((a: T, b: T) => number) | null, cost: (t: T) => number): T[] => {
    const byCost = [...list].sort((a, b) => cost(a) - cost(b));
    const chosen = new Set(byCost.slice(0, cheapest));
    if (alsoBest && list.length) chosen.add([...list].sort(alsoBest)[0]);
    return [...chosen];
  };
  let noWayHome = 0;
  for (const [hub, cands] of byHub) {
    const doms = domesticByHub.get(hub) ?? [];
    const homeDoms = returnDomesticByHub.get(hub) ?? [];
    const tz = tzOf(hub);
    for (const c of cands) {
      const ground = groundFor.get(c.out.origin);
      // Outbound: international → domestic.
      const outs = doms
        .map((d) => ({ d, check: checkConnection(c.out, d, hub, tz, config, connOpts) }))
        .filter((x) => x.check.ok);
      const outPicks = pick(outs, c.back ? 2 : s.max_domestic_per_intl, (a, b) => Date.parse(a.d.arriveUtc) - Date.parse(b.d.arriveUtc), (x) => x.d.price.totalGbp);
      // Return: domestic → international.
      let backPicks: { d: NormalisedItinerary; check: ConnectionCheck }[] | null = null;
      if (c.back) {
        const backs = homeDoms
          .map((d) => ({ d, check: checkConnection(d, c.back!, hub, tz, config, connOpts, "back") }))
          .filter((x) => x.check.ok);
        backPicks = pick(backs, 2, (a, b) => Date.parse(b.d.departUtc) - Date.parse(a.d.departUtc), (x) => x.d.price.totalGbp);
        if (!backPicks.length) {
          if (outPicks.length) noWayHome++;
          continue;
        }
      }
      const combos: RouteOption[] = [];
      for (const o of outPicks) {
        const outLegs = [bagLeg(c.out, "international"), bagLeg(o.d, "domestic")];
        if (!backPicks) {
          combos.push(buildOption("split", outLegs, ground, req, s.uk_airport_arrival_mins, o.check.connection));
          continue;
        }
        for (const bk of backPicks) {
          const ret = { legs: [bagLeg(bk.d, "domestic"), bagLeg(c.back!, "international", true)], connection: bk.check.connection, ukExitMins: s.uk_arrival_exit_mins };
          combos.push(buildOption("split", outLegs, ground, req, s.uk_airport_arrival_mins, o.check.connection, ret));
        }
      }
      options.push(...pick(combos, s.max_domestic_per_intl, (a, b) => a.totalMins - b.totalMins, (o) => o.costs.total));
    }
  }
  if (noWayHome) notes.push(`${noWayHome} return fares dropped: no domestic flight home on ${returnDate} connects in time.`);

  // De-duplicate by the actual flights (the same itinerary can come back from
  // neighbouring dates, or from the with/without-bags through searches).
  // Prefer the copy whose bags Ignav confirmed, then the cheaper one.
  const signature = (o: RouteOption) =>
    allLegs(o).flatMap((l) => l.itinerary.segments.map((s) => `${s.carrier}${s.flightNumber}@${s.departUtc}`)).join("|");
  const better = (a: RouteOption, b: RouteOption) =>
    Number(a.costs.bagsUnknown) - Number(b.costs.bagsUnknown) || a.costs.total - b.costs.total;
  const bySig = new Map<string, RouteOption>();
  for (const o of options) {
    const k = signature(o);
    const prev = bySig.get(k);
    if (!prev || better(o, prev) < 0) bySig.set(k, o);
  }
  const unique = [...bySig.values()].sort((a, b) => a.costs.total - b.costs.total || a.totalMins - b.totalMins);

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
  for (const o of unique) for (const l of allLegs(o)) for (const seg of l.itinerary.segments) {
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
