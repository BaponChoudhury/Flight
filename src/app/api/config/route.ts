import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { CONFIG_TABLES, getStore, type ConfigTable } from "@/lib/store";
import type { Settings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  const config = await store.loadConfig();
  return NextResponse.json({ config, storage: store.kind, hasApiKey: !!process.env.IGNAV_API_KEY });
}

export async function PUT(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as
    | { table: ConfigTable; rows: Record<string, unknown>[] }
    | { settings: Settings }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const store = getStore();
  try {
    if ("settings" in body) {
      await store.saveSettings(body.settings);
    } else {
      if (!(body.table in CONFIG_TABLES) || !Array.isArray(body.rows))
        return NextResponse.json({ error: "Unknown table." }, { status: 400 });
      await store.replaceTable(body.table, body.rows);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
