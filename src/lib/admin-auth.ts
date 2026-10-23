import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Admin-only endpoints (hidden-market quotes, config edits) need ADMIN_PASSWORD in the
 * `x-admin-key` header. Customers share APP_PASSWORD, so that alone isn't enough.
 * Fails closed: without ADMIN_PASSWORD set, admin data is unavailable.
 */
export function requireAdmin(request: Request): NextResponse | null {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return NextResponse.json({ error: "Admin is locked: set ADMIN_PASSWORD on the server." }, { status: 503 });
  const given = request.headers.get("x-admin-key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Admin password required." }, { status: 401 });
  return null;
}
