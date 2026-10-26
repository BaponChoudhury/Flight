import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { sendDueFollowups } from "@/lib/followups-send";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// Admin: send today's due follow-ups now, without waiting for the daily job.
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await sendDueFollowups(getStore()));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
