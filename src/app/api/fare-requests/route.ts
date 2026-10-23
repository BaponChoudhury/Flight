import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?[0-9 ()-]{7,20}$/;

// Customer asks us to book a hidden-market quote. No payment is taken here.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    quoteId?: string;
    contact?: { name?: string; email?: string; phone?: string };
    notes?: string;
  } | null;
  const name = body?.contact?.name?.trim() ?? "";
  const email = body?.contact?.email?.trim().toLowerCase() ?? "";
  const phone = body?.contact?.phone?.trim() ?? "";
  if (!body?.quoteId) return NextResponse.json({ error: "Missing quote." }, { status: 400 });
  if (name.length < 2 || name.length > 100) return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  if (!EMAIL.test(email)) return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  if (!PHONE.test(phone)) return NextResponse.json({ error: "Please enter a valid phone number." }, { status: 400 });

  const store = getStore();
  const quote = await store.getQuote(body.quoteId);
  if (!quote) return NextResponse.json({ error: "This price is no longer available. Please search again." }, { status: 404 });
  if (Date.parse(quote.expires_at) < Date.now())
    return NextResponse.json({ error: "This price has expired. Please tap 'Get booking links' again to re-check it." }, { status: 410 });

  const id = `fr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await store.createFareRequest({
    id,
    quote_id: quote.id,
    created_at: new Date().toISOString(),
    status: "new",
    contact: { name, email, phone },
    notes: body.notes?.trim().slice(0, 1000) || null,
  });
  return NextResponse.json({ requestId: id, priceGbp: quote.price_gbp }, { status: 201 });
}

// Admin view: includes the hidden market, seller and link, so admin password only.
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const requests = await getStore().listFareRequests(100);
  return NextResponse.json({ requests });
}
