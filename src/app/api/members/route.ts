import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

// Admin view: everyone who signed in, and whether they agreed to marketing emails.
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ members: await getStore().listMembers(1000) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
