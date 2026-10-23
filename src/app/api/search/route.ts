import { NextResponse } from "next/server";
import { runSearch, validateRequest } from "@/lib/engine/search";
import { aviasalesConfigured, createAviasalesProvider } from "@/lib/providers/aviasales";
import { ignavProvider } from "@/lib/providers/ignav";
import { clientOf } from "@/lib/client";
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
    // Aviasales needs the searching user's own IP and our site's host on every search.
    const throughProviders = aviasalesConfigured() ? [createAviasalesProvider(clientOf(request))] : [];
    const result = await runSearch(body, { store: getStore(), provider: ignavProvider, throughProviders });
    return NextResponse.json(result);
  } catch (err) {
    console.error("search failed", err);
    return NextResponse.json({ error: `Search failed: ${(err as Error).message}` }, { status: 500 });
  }
}
