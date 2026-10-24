import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

// Admin view: recent Aviasales booking links and their SubIDs, to match against
// bookings in Travelpayouts (Statistics → Aviasales → Bookings).
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ clicks: await getStore().listBookingClicks(200) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
