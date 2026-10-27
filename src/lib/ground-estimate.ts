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
 * Fitted to published fares (checked Oct 2026), road km from our straight-line × 1.3:
 * - Train, typical on-the-day single (Omio route averages): Leeds→MAN ~£18, Birmingham→MAN ~£24,
 *   Leicester→Birmingham Intl ~£20–23. Advance tickets can be about half this.
 * - Coach, National Express/Megabus averages (Omio): Leeds→MAN £4–7, Birmingham→Heathrow £8–25,
 *   London→MAN ~£21.
 * - Cab, pre-booked fixed-price saloon for the whole car: Coventry→Birmingham Airport £50–52
 *   (metered ~£33), Bradford→MAN ~£80, Leeds→MAN ~£90, Birmingham→Heathrow £225–257.
 *   No official UK average exists for pre-booked airport cabs; these are operators' listed fares.
 */
export const ESTIMATE_NOTE =
  "typical fares for the distance, from published route prices (train: on-the-day single; coach: average single; cab: pre-booked fixed fare for the car). Check yours with the links.";

/** Estimated one-way fares from `home` to the airport `code`. Null for airports we have no position for. */
export function estimateGround(home: { lat: number; lon: number }, code: string): GroundEstimate | null {
  const airport = UK_AIRPORTS.find((a) => a.code === code);
  if (!airport) return null;
  const roadKm = straightKm(home.lat, home.lon, airport.lat, airport.lon) * ROUTE_FACTOR;
  return {
    trainPerPerson: Math.max(5, Math.round(8 + 0.12 * roadKm)),
    coachPerPerson: Math.max(5, Math.round(3 + 0.05 * roadKm)),
    cabTotal: Math.max(25, Math.round(15 + 1.05 * roadKm)),
    roadKm: Math.round(roadKm),
  };
}
