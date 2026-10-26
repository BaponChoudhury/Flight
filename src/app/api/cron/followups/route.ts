import { NextResponse } from "next/server";
import { sendDueFollowups } from "@/lib/followups-send";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// Daily job (vercel.json "crons"). Vercel sends "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json(await sendDueFollowups(getStore()));
}
