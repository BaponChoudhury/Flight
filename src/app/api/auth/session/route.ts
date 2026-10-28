import { NextResponse } from "next/server";
import { authConfigured, safeNext, userFromToken } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_DAYS, signSession } from "@/lib/session";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

// Step 2 of sign-in: the callback page hands over the token from the email link; we check it
// with Supabase, record the member (and their marketing choice) and set our session cookie.
export async function POST(request: Request) {
  if (!authConfigured()) return NextResponse.json({ error: "Sign-in isn't available right now." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { access_token?: unknown; marketing?: unknown; next?: unknown } | null;
  const token = typeof body?.access_token === "string" ? body.access_token : "";
  const user = token ? await userFromToken(token) : null;
  if (!user) return NextResponse.json({ error: "This sign-in link has expired or was already used. Please ask for a new one." }, { status: 401 });
  try {
    await getStore().upsertMember({ user_id: user.id, email: user.email.toLowerCase(), marketing_opt_in: body?.marketing === true });
  } catch (err) {
    // Signing in still works; the member list just misses this visit.
    console.error("member upsert failed", (err as Error).message);
  }
  const res = NextResponse.json({ next: safeNext(body?.next) });
  res.cookies.set(SESSION_COOKIE, signSession({ uid: user.id, email: user.email }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return res;
}
