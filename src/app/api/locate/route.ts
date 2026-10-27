import { NextResponse } from "next/server";
import { airportNamed, haversineKm, nearestUkAirports } from "@/lib/config/places";
import { locate } from "@/lib/locate";

export const runtime = "nodejs";

// UK place or postcode → nearest airports.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ error: "Type a UK town or postcode." }, { status: 400 });
  try {
    const place = await locate(q);
    if (!place) return NextResponse.json({ error: `Couldn't find "${q}" in the UK. Try a nearby town or a postcode.` }, { status: 404 });
    const airports = nearestUkAirports(place.lat, place.lon);
    // Typed an airport's name ("Luton", "Gatwick")? Offer that airport first.
    const named = airportNamed(q);
    if (named && !airports.some((a) => a.code === named.code))
      airports.unshift({ code: named.code, name: named.name, km: Math.round(haversineKm(place.lat, place.lon, named.lat, named.lon)) });
    return NextResponse.json({ place, airports });
  } catch {
    return NextResponse.json({ error: "Location lookup isn't available right now — pick your airports below." }, { status: 502 });
  }
}
