// Pure rules: connection buffers, terminals, baggage and cost aggregation.
// No I/O here so everything is unit-testable.

import type {
  AppConfig,
  BagAssessment,
  Connection,
  CostBreakdown,
  FlightLeg,
  GroundAccess,
  NormalisedItinerary,
  RouteOption,
  RouteType,
  SearchRequest,
  Settings,
} from "@/lib/types";
import { addMinutes, crossesLocalMidnight, minutesBetween } from "./time";

// ---------- Terminals & buffers ----------

function byAirline<T extends { airline_code: string }>(rows: T[], airline: string | null): T | undefined {
  return rows.find((r) => r.airline_code === airline) ?? rows.find((r) => r.airline_code === "*");
}

export function terminalFor(
  config: Pick<AppConfig, "airlineTerminals">,
  airport: string,
  airline: string | null,
  routeType: RouteType,
): string | null {
  const rows = config.airlineTerminals.filter((t) => t.airport === airport && t.route_type === routeType);
  return byAirline(rows, airline)?.terminal ?? null;
}

export interface ConnectionCheck {
  ok: boolean;
  reason?: "too_short" | "too_long";
  connection: Connection;
}

/**
 * Validate a self-transfer at `hub` between an international arrival and a
 * domestic departure. Both times are UTC; the hub's timezone is only used to
 * decide whether the layover is overnight.
 */
export function checkConnection(
  arriving: NormalisedItinerary,
  departing: NormalisedItinerary,
  hub: string,
  hubTz: string,
  config: Pick<AppConfig, "airlineTerminals" | "terminalRules" | "settings">,
  opts: { minBufferMins: number; allowOvernight: boolean },
  /** "out": international lands, domestic leaves. "back": domestic lands, international leaves. */
  direction: "out" | "back" = "out",
): ConnectionCheck {
  const s = config.settings;
  const bufferMins = minutesBetween(arriving.arriveUtc, departing.departUtc);

  const lastArrivingCarrier = arriving.segments[arriving.segments.length - 1]?.carrier ?? arriving.carrier;
  const firstDepartingCarrier = departing.segments[0]?.carrier ?? departing.carrier;
  const [arriveType, departType]: RouteType[] = direction === "out" ? ["international", "domestic"] : ["domestic", "international"];
  const from = terminalFor(config, hub, lastArrivingCarrier, arriveType);
  const to = terminalFor(config, hub, firstDepartingCarrier, departType);
  let extra = 0;
  let terminalChange: Connection["terminalChange"] = null;
  if (from && to && from !== to) {
    terminalChange = { from, to };
    extra =
      config.terminalRules.find((r) => r.airport === hub && r.from_terminal === from && r.to_terminal === to)
        ?.extra_mins ?? s.terminal_change_default_mins;
  }

  const minRequiredMins = opts.minBufferMins + extra;
  const maxMins = opts.allowOvernight ? s.overnight_max_buffer_mins : s.max_buffer_mins;
  const overnight = bufferMins >= 360 && crossesLocalMidnight(arriving.arriveUtc, departing.departUtc, hubTz);
  // Hotels aren't offered yet, so an overnight stop adds nothing to the price.
  const hotelGbp = 0;

  const connection: Connection = { airport: hub, bufferMins, minRequiredMins, terminalChange, overnight, hotelGbp };
  if (bufferMins < minRequiredMins) return { ok: false, reason: "too_short", connection };
  if (bufferMins > maxMins) return { ok: false, reason: "too_long", connection };
  return { ok: true, connection };
}

// ---------- Baggage ----------

/** Typical international checked bag, used to flag smaller allowances when the user gives no weight. */
export const STANDARD_BAG_KG = 23;

/**
 * Work out what the user's checked bags will cost on one ticket.
 * `bags` and `bagKg` are per passenger.
 */
/**
 * Checked bags on one ticket. Searches ask Ignav for fares that already
 * include the user's bags (min_checked_bags), so the fare price is the
 * bag-inclusive price. We never add our own bag fees: if Ignav doesn't confirm
 * the bags, the result is "unknown". The weight allowance (config) only drives
 * an informational "Excess baggage risk" flag.
 */
export function assessBags(
  it: NormalisedItinerary,
  routeType: RouteType,
  req: Pick<SearchRequest, "bags" | "bagKg" | "adults" | "children">,
  config: Pick<AppConfig, "airlineBagDefaults">,
): BagAssessment {
  const defaults = byAirline(config.airlineBagDefaults.filter((d) => d.route_type === routeType), it.carrier);
  const includedKg = defaults?.included_kg ?? null;
  const pieces = it.baggage.checkedPieces;

  if (req.bags <= 0) {
    return { status: "included", feeGbp: 0, excessGbp: 0, includedPieces: pieces, includedKg, excessRisk: false, note: "No checked bags needed" };
  }

  const kg = req.bagKg ?? null;
  const excessRisk = includedKg != null && (kg != null ? kg > includedKg : includedKg < STANDARD_BAG_KG);

  if (pieces == null || pieces < req.bags) {
    return {
      status: "unknown",
      feeGbp: 0,
      excessGbp: 0,
      includedPieces: pieces,
      includedKg,
      excessRisk,
      note: pieces == null ? "Bags not confirmed by the airline data" : `Only ${pieces} checked bag${pieces === 1 ? "" : "s"} included; extra bag price unknown`,
    };
  }
  return {
    status: "included",
    feeGbp: 0,
    excessGbp: 0,
    includedPieces: pieces,
    includedKg,
    excessRisk,
    note: `${pieces} checked bag${pieces === 1 ? "" : "s"} included in the fare`,
  };
}

// ---------- Costs ----------

export function groundCost(g: GroundAccess, pax: number): number {
  return g.per_person ? g.cost_gbp * pax : g.cost_gbp;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function aggregateCosts(ground: number, legs: FlightLeg[], hotel: number): CostBreakdown {
  const fares = legs.map((l) => round2(l.itinerary.price.totalGbp));
  const bags = round2(legs.reduce((s, l) => s + l.bag.feeGbp, 0));
  const excessBaggage = round2(legs.reduce((s, l) => s + l.bag.excessGbp, 0));
  const total = round2(ground + fares.reduce((a, b) => a + b, 0) + bags + excessBaggage + hotel);
  return {
    ground: round2(ground),
    fares,
    bags,
    excessBaggage,
    hotel: round2(hotel),
    total,
    bagsUnknown: legs.some((l) => l.bag.status === "unknown"),
  };
}

// ---------- Scoring ----------

export interface Scored {
  costs: CostBreakdown;
  totalMins: number;
}

/**
 * Best-value score in [0, 1+]: lower is better. `priceWeight` 1 = price only,
 * 0 = time only. Unknown bag prices are pushed down by a fixed penalty.
 */
export function valueScores<T extends Scored>(options: T[], priceWeight: number, settings: Pick<Settings, "unknown_bag_penalty">): number[] {
  if (!options.length) return [];
  const costs = options.map((o) => o.costs.total);
  const times = options.map((o) => o.totalMins);
  const [cMin, cMax] = [Math.min(...costs), Math.max(...costs)];
  const [tMin, tMax] = [Math.min(...times), Math.max(...times)];
  const norm = (v: number, lo: number, hi: number) => (hi === lo ? 0 : (v - lo) / (hi - lo));
  return options.map(
    (o) =>
      priceWeight * norm(o.costs.total, cMin, cMax) +
      (1 - priceWeight) * norm(o.totalMins, tMin, tMax) +
      (o.costs.bagsUnknown ? settings.unknown_bag_penalty : 0),
  );
}

export function rankOptions<T extends Scored>(options: T[], priceWeight: number, settings: Pick<Settings, "unknown_bag_penalty">) {
  const scores = valueScores(options, priceWeight, settings);
  const byValue = options.map((o, i) => ({ o, s: scores[i] })).sort((a, b) => a.s - b.s).map((x) => x.o);
  const rankCost = (o: T) => o.costs.total + (o.costs.bagsUnknown ? 1e6 : 0);
  const cheapest = [...options].sort((a, b) => rankCost(a) - rankCost(b))[0] ?? null;
  const fastest = [...options].sort((a, b) => a.totalMins - b.totalMins || a.costs.total - b.costs.total)[0] ?? null;
  return { cheapest, fastest, bestValue: byValue[0] ?? null, top: byValue.slice(0, 10) };
}

// ---------- User-entered ground travel (applied on the results page) ----------

export type GroundMode = "train" | "coach" | "cab";

/** What the user typed for one UK airport (prices only). Blank fields are null. */
export interface GroundInput {
  trainPerPerson: number | null;
  coachPerPerson: number | null;
  cabTotal: number | null; // whole car
  use: "cheapest" | GroundMode;
}

export interface GroundChoice {
  mode: GroundMode;
  costGbp: number; // whole party
  detail: string;
}

export function groundChoices(input: GroundInput, pax: number): GroundChoice[] {
  const out: GroundChoice[] = [];
  if (input.trainPerPerson != null) out.push({ mode: "train", costGbp: input.trainPerPerson * pax, detail: `${pax} × £${input.trainPerPerson}` });
  if (input.coachPerPerson != null) out.push({ mode: "coach", costGbp: input.coachPerPerson * pax, detail: `${pax} × £${input.coachPerPerson}` });
  if (input.cabTotal != null) out.push({ mode: "cab", costGbp: input.cabTotal, detail: "whole car" });
  return out;
}

/** The option the route will use, or null if the user hasn't entered a usable one. */
export function pickGround(input: GroundInput, pax: number): GroundChoice | null {
  const choices = groundChoices(input, pax);
  if (input.use !== "cheapest") return choices.find((c) => c.mode === input.use) ?? null;
  return [...choices].sort((a, b) => a.costGbp - b.costGbp)[0] ?? null;
}

/**
 * Re-price an option with a different way of getting to the UK airport. Travel time
 * isn't asked for, so times run from the airport: "leave home" becomes "at the airport by".
 */
export function applyGround(o: RouteOption, choice: GroundChoice, ukArrivalMins: number, ukExitMins = 60): RouteOption {
  const firstDepart = o.legs[0].itinerary.departUtc;
  const leaveHomeUtc = addMinutes(firstDepart, -ukArrivalMins);
  const trips = o.back ? 2 : 1; // home → airport, and airport → home on a return trip
  const ground = Math.round(choice.costGbp * trips * 100) / 100;
  const outMins = minutesBetween(leaveHomeUtc, o.arriveUtc);
  let back = o.back;
  if (back) {
    const arriveHomeUtc = addMinutes(back.arriveUkUtc, ukExitMins);
    back = { ...back, arriveHomeUtc, totalMins: minutesBetween(back.leaveDestUtc, arriveHomeUtc) };
  }
  return {
    ...o,
    ground: { ...o.ground, mode: choice.mode, cost_gbp: choice.costGbp, per_person: false, duration_mins: 0, notes: choice.detail + (trips === 2 ? ", each way" : "") },
    costs: { ...o.costs, ground, total: Math.round((o.costs.total - o.costs.ground + ground) * 100) / 100 },
    leaveHomeUtc,
    outMins,
    back,
    totalMins: outMins + (back?.totalMins ?? 0),
  };
}

/** The option with getting to the airport taken out, as shown until the user turns on door to door. */
export function withoutGround(o: RouteOption): RouteOption {
  if (o.ground.mode === "not set" && !o.costs.ground) return o;
  return {
    ...o,
    ground: { ...o.ground, mode: "not set", cost_gbp: 0, notes: "" },
    costs: { ...o.costs, ground: 0, total: Math.round((o.costs.total - o.costs.ground) * 100) / 100 },
  };
}

// ---------- Refundable filter (results page) ----------

export const isRefundable = (o: RouteOption) => o.badges.includes("Refundable");

/** The option as shown with "Refundable tickets only" on, or null if it has no refundable fare. */
export const refundableView = (o: RouteOption): RouteOption | null => (isRefundable(o) ? o : (o.refundableVersion ?? null));
