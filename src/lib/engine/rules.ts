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
  intl: NormalisedItinerary,
  dom: NormalisedItinerary,
  hub: string,
  hubTz: string,
  config: Pick<AppConfig, "airlineTerminals" | "terminalRules" | "settings">,
  opts: { minBufferMins: number; allowOvernight: boolean },
): ConnectionCheck {
  const s = config.settings;
  const bufferMins = minutesBetween(intl.arriveUtc, dom.departUtc);

  const lastIntlCarrier = intl.segments[intl.segments.length - 1]?.carrier ?? intl.carrier;
  const firstDomCarrier = dom.segments[0]?.carrier ?? dom.carrier;
  const from = terminalFor(config, hub, lastIntlCarrier, "international");
  const to = terminalFor(config, hub, firstDomCarrier, "domestic");
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
  const overnight = bufferMins >= 360 && crossesLocalMidnight(intl.arriveUtc, dom.departUtc, hubTz);
  const hotelGbp = overnight && opts.allowOvernight ? (s.hotel_gbp_by_hub[hub] ?? s.hotel_gbp_default) : 0;

  const connection: Connection = { airport: hub, bufferMins, minRequiredMins, terminalChange, overnight, hotelGbp };
  if (bufferMins < minRequiredMins) return { ok: false, reason: "too_short", connection };
  if (bufferMins > maxMins) return { ok: false, reason: "too_long", connection };
  return { ok: true, connection };
}

// ---------- Baggage ----------

/**
 * Work out what the user's checked bags will cost on one ticket.
 * `bags` and `bagKg` are per passenger.
 */
export function assessBags(
  it: NormalisedItinerary,
  routeType: RouteType,
  req: Pick<SearchRequest, "bags" | "bagKg" | "adults" | "children">,
  config: Pick<AppConfig, "bagFees" | "airlineBagDefaults">,
): BagAssessment {
  const pax = req.adults + req.children;
  const airline = it.carrier;
  const defaults = byAirline(
    config.airlineBagDefaults.filter((d) => d.route_type === routeType),
    airline,
  );
  const includedKg = defaults?.included_kg ?? null;

  if (req.bags <= 0) {
    return { status: "included", feeGbp: 0, excessGbp: 0, includedPieces: it.baggage.checkedPieces, includedKg, excessRisk: false, note: "No checked bags needed" };
  }

  let pieces = it.baggage.checkedPieces;
  let estimated = false;
  if (pieces == null && defaults?.included_pieces != null) {
    pieces = defaults.included_pieces;
    estimated = true;
  }

  // Weight risk applies to bags that are included as well as bought ones.
  const excessRisk = includedKg != null && req.bagKg > includedKg;
  const excessGbp =
    excessRisk && defaults?.excess_per_kg_gbp != null
      ? (req.bagKg - (includedKg as number)) * defaults.excess_per_kg_gbp * req.bags * pax
      : 0;

  if (pieces == null) {
    return { status: "unknown", feeGbp: 0, excessGbp, includedPieces: null, includedKg, excessRisk, note: "Airline didn't say whether bags are included" };
  }

  const missing = Math.max(0, req.bags - pieces);
  if (missing === 0) {
    return {
      status: estimated ? "estimated" : "included",
      feeGbp: 0,
      excessGbp,
      includedPieces: pieces,
      includedKg,
      excessRisk,
      note: `${pieces} checked bag${pieces === 1 ? "" : "s"} included${estimated ? " (estimated)" : ""}`,
    };
  }

  const fee = config.bagFees
    .filter((f) => f.route_type === routeType && (f.airline_code === airline || f.airline_code === "*") && f.bag_kg >= req.bagKg)
    .sort((a, b) => (a.airline_code === "*" ? 1 : 0) - (b.airline_code === "*" ? 1 : 0) || a.bag_kg - b.bag_kg)[0];
  if (!fee) {
    return { status: "unknown", feeGbp: 0, excessGbp, includedPieces: pieces, includedKg, excessRisk, note: `Need ${missing} more bag${missing === 1 ? "" : "s"} each; price unknown` };
  }
  return {
    status: "fee",
    feeGbp: fee.fee_gbp * missing * pax,
    excessGbp: 0, // a bought bag is bought at the right weight
    includedPieces: pieces,
    includedKg,
    excessRisk: false,
    note: `${missing} extra bag${missing === 1 ? "" : "s"} × ${pax} traveller${pax === 1 ? "" : "s"} at £${fee.fee_gbp}`,
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

export type GroundMode = "train" | "cab";

/** What the user typed for one UK airport. Blank fields are null. */
export interface GroundInput {
  trainPerPerson: number | null;
  trainMins: number | null;
  cabTotal: number | null; // whole car
  cabMins: number | null;
  use: "cheapest" | GroundMode;
}

export interface GroundChoice {
  mode: GroundMode;
  costGbp: number; // whole party
  mins: number;
  detail: string;
}

export function groundChoices(input: GroundInput, pax: number): GroundChoice[] {
  const out: GroundChoice[] = [];
  if (input.trainPerPerson != null && input.trainMins != null)
    out.push({ mode: "train", costGbp: input.trainPerPerson * pax, mins: input.trainMins, detail: `${pax} × £${input.trainPerPerson}` });
  if (input.cabTotal != null && input.cabMins != null)
    out.push({ mode: "cab", costGbp: input.cabTotal, mins: input.cabMins, detail: "whole car" });
  return out;
}

/** The option the route will use, or null if the user hasn't entered a usable one. */
export function pickGround(input: GroundInput, pax: number): GroundChoice | null {
  const choices = groundChoices(input, pax);
  if (input.use !== "cheapest") return choices.find((c) => c.mode === input.use) ?? null;
  return [...choices].sort((a, b) => a.costGbp - b.costGbp || a.mins - b.mins)[0] ?? null;
}

/**
 * Re-price an option with a different way of getting to the UK airport:
 * replaces the ground cost and moves "leave home" so door-to-door time stays right.
 */
export function applyGround(o: RouteOption, choice: GroundChoice, ukArrivalMins: number): RouteOption {
  const firstDepart = o.legs[0].itinerary.departUtc;
  const leaveHomeUtc = addMinutes(firstDepart, -(ukArrivalMins + choice.mins));
  const ground = Math.round(choice.costGbp * 100) / 100;
  return {
    ...o,
    ground: { ...o.ground, mode: choice.mode, cost_gbp: choice.costGbp, per_person: false, duration_mins: choice.mins, notes: choice.detail },
    costs: { ...o.costs, ground, total: Math.round((o.costs.total - o.costs.ground + ground) * 100) / 100 },
    leaveHomeUtc,
    totalMins: minutesBetween(leaveHomeUtc, o.arriveUtc),
  };
}
