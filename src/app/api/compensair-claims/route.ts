import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { compensairConfigured, listApplications } from "@/lib/compensair";

export const runtime = "nodejs";

// Admin view: claims sent with our Compensair partner token over the last year, with their stage.
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  if (!compensairConfigured()) return NextResponse.json({ error: "COMPENSAIR_TOKEN is not set on the server." }, { status: 503 });
  const end = new Date();
  const start = new Date(end.getTime() - 365 * 86_400_000);
  try {
    return NextResponse.json(await listApplications(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
