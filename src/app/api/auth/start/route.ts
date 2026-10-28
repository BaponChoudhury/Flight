import { NextResponse } from "next/server";
import { authConfigured, EMAIL, safeNext, sendSignInLink } from "@/lib/auth";

export const runtime = "nodejs";

// Step 1 of sign-in: email the person a one-time link back to /auth/callback.
export async function POST(request: Request) {
  if (!authConfigured()) return NextResponse.json({ error: "Sign-in isn't available right now." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { email?: unknown; marketing?: unknown; next?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 200) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(request.url).host;
  const proto = h.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const back = new URL(`${proto}://${host}/auth/callback`);
  back.searchParams.set("next", safeNext(body?.next));
  if (body?.marketing === true) back.searchParams.set("m", "1");
  try {
    await sendSignInLink(email, back.toString());
  } catch (err) {
    const msg = (err as Error).message;
    console.error("sign-in link failed", msg);
    const rate = /rate|too many|security purposes/i.test(msg);
    return NextResponse.json({ error: rate ? "Too many sign-in emails just now. Please try again in a few minutes." : "We couldn't send the email. Please try again." }, { status: rate ? 429 : 502 });
  }
  return NextResponse.json({ ok: true });
}
