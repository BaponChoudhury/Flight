// Typical one-way fares from home to a UK airport, by distance, so door-to-door totals
// start from a sensible figure. Shown as estimates; the user can type their real fare.

import { UK_AIRPORTS } from "@/lib/config/places";

export interface GroundEstimate {
  trainPerPerson: number;
  coachPerPerson: number;
  cabTotal: number;
  roadKm: number;
}

/** Roads and rail lines are longer than the straight line; about 30% on UK journeys to airports. */
const ROUTE_FACTOR = 1.3;

export function straightKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Estimated fares from `home` to the airport `code` (any airport in our UK list, LON included).
 * Train: a typical advance/off-peak single. Coach: National Express-style single. Cab: whole car,
 * about £1.50 per road km plus a pick-up charge. Null for airports we have no position for.
 */
export function estimateGround(home: { lat: number; lon: number }, code: string): GroundEstimate | null {
  const airport = UK_AIRPORTS.find((a) => a.code === code);
  if (!airport) return null;
  const roadKm = straightKm(home.lat, home.lon, airport.lat, airport.lon) * ROUTE_FACTOR;
  return {
    trainPerPerson: Math.max(6, Math.round(5 + 0.18 * roadKm)),
    coachPerPerson: Math.max(5, Math.round(3 + 0.07 * roadKm)),
    cabTotal: Math.max(15, Math.round(4 + 1.5 * roadKm)),
    roadKm: Math.round(roadKm),
  };
}
