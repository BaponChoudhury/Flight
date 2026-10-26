import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { buildFollowup, emailConfigured } from "@/lib/followups";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

// A traveller opts in to a compensation check email after their trip.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const f = buildFollowup(body);
  if (typeof f === "string") return NextResponse.json({ error: f }, { status: 400 });
  try {
    await getStore().createFollowup(f);
  } catch (err) {
    console.error("follow-up not saved", (err as Error).message);
    return NextResponse.json({ error: "Couldn't save that right now. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ sendAfter: f.send_after }, { status: 201 });
}

// Admin view: follow-ups with email addresses partly hidden.
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const rows = await getStore().listFollowups(200);
    const mask = (e: string | null) => (e ? e.replace(/^(.).*(@.*)$/, "$1***$2") : null);
    return NextResponse.json({
      emailConfigured: emailConfigured(),
      followups: rows.map((r) => ({ id: r.id, created_at: r.created_at, trip: r.trip, send_after: r.send_after, sent_at: r.sent_at, unsubscribed_at: r.unsubscribed_at, email: mask(r.email) })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
