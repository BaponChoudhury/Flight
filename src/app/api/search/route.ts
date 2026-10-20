import { NextResponse } from "next/server";
import { runSearch, validateRequest } from "@/lib/engine/search";
import { ignavProvider } from "@/lib/providers/ignav";
import { getStore } from "@/lib/store";
import type { SearchRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: SearchRequest;
  try {
    body = (await request.json()) as SearchRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const invalid = validateRequest(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  try {
    const result = await runSearch(body, { store: getStore(), provider: ignavProvider });
    return NextResponse.json(result);
  } catch (err) {
    console.error("search failed", err);
    return NextResponse.json({ error: `Search failed: ${(err as Error).message}` }, { status: 500 });
  }
}
