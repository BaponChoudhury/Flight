import { NextResponse } from "next/server";
import { getAirportIndex, searchAirports } from "@/lib/airports-index";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// Airport search for the "To" box. Free: uses the OurAirports index, never Ignav.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const country = url.searchParams.get("country")?.toUpperCase() || undefined;
  if (q.length < 2) return NextResponse.json({ airports: [] });
  try {
    const index = await getAirportIndex(getStore());
    return NextResponse.json({ airports: searchAirports(index, q, { country, limit: 8 }) });
  } catch (err) {
    return NextResponse.json({ error: `Airport list unavailable: ${(err as Error).message}` }, { status: 502 });
  }
}
