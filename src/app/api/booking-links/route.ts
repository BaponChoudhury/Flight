import { NextResponse } from "next/server";
import { createCallContext } from "@/lib/engine/calls";
import { ignavProvider } from "@/lib/providers/ignav";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 30;

// Fetched lazily, only when the user taps "Get booking links" (each call is billed).
export async function POST(request: Request) {
  const { providerRef, adults, children, infants } = (await request.json().catch(() => ({}))) as {
    providerRef?: string;
    adults?: number;
    children?: number;
    infants?: number;
  };
  if (!providerRef || !adults) return NextResponse.json({ error: "Missing itinerary." }, { status: 400 });
  const store = getStore();
  const { settings } = await store.loadConfig();
  const ctx = createCallContext(store, settings);
  try {
    const links = await ignavProvider.getBookingLinks(
      providerRef,
      { adults, children: children ?? 0, infants: infants ?? 0, allowSelfTransfer: false },
      ctx,
    );
    return NextResponse.json({ links, fromCache: ctx.log[0]?.cacheHit ?? false });
  } catch (err) {
    return NextResponse.json({ error: `Couldn't get booking links: ${(err as Error).message}` }, { status: 502 });
  }
}
