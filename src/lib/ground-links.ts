// "Check price" links for getting from home to a UK airport.
// Only Google Maps has a documented, pre-fillable URL format
// (https://developers.google.com/maps/documentation/urls/guide); the operators'
// sites don't publish one, so those links open their journey search page.

import { UK_AIRPORTS } from "@/lib/config/places";

export interface GroundLink {
  label: string;
  href: string;
  prefilled: boolean;
}

/** "LHR" → "London Heathrow Airport", the text Google Maps resolves best. */
export function airportPlaceName(code: string): string {
  const name = UK_AIRPORTS.find((a) => a.code === code)?.name;
  if (!name) return `${code} airport`;
  return /airport/i.test(name) ? name : `${name} Airport`;
}

export function mapsDirections(origin: string, destination: string, mode: "transit" | "driving"): string {
  const q = new URLSearchParams({ api: "1", origin, destination, travelmode: mode });
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

export function groundLinks(originArea: string, airportCode: string) {
  const dest = airportPlaceName(airportCode);
  return {
    train: [
      { label: "Train times (Google Maps)", href: mapsDirections(originArea, dest, "transit"), prefilled: true },
      { label: "National Rail fares", href: "https://www.nationalrail.co.uk/journey-planner/", prefilled: false },
    ],
    coach: [
      { label: "National Express", href: "https://www.nationalexpress.com/en", prefilled: false },
      { label: "FlixBus", href: "https://www.flixbus.co.uk/", prefilled: false },
    ],
    cab: [{ label: "Drive time (Google Maps)", href: mapsDirections(originArea, dest, "driving"), prefilled: true }],
  } satisfies Record<"train" | "coach" | "cab", GroundLink[]>;
}
