// Signed session cookie for signed-in members. Supabase Auth checks the email link once; after
// that we keep our own small cookie so pages don't need Supabase on every request.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "fl_session";
export const SESSION_DAYS = 30;

export interface Session {
  uid: string;
  email: string;
  exp: number; // ms since epoch
}

/** SESSION_SECRET if set; otherwise derived from the Supabase service key (server-only either way). */
function secret(): string | null {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return k ? createHash("sha256").update(`flight-session:${k}`).digest("hex") : null;
}

const mac = (payload: string, key: string) => createHmac("sha256", key).update(payload).digest("base64url");

export function signSession(s: Omit<Session, "exp">, now = Date.now(), key = secret()): string {
  if (!key) throw new Error("Sign-in isn't set up on this server (no SUPABASE_SERVICE_ROLE_KEY or SESSION_SECRET).");
  const payload = Buffer.from(JSON.stringify({ ...s, exp: now + SESSION_DAYS * 86_400_000 })).toString("base64url");
  return `${payload}.${mac(payload, key)}`;
}

export function readSession(cookie: string | undefined | null, now = Date.now(), key = secret()): Session | null {
  if (!cookie || !key) return null;
  const [payload, sig] = cookie.split(".");
  if (!payload || !sig) return null;
  const want = Buffer.from(mac(payload, key));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    return typeof s.uid === "string" && typeof s.email === "string" && s.exp > now ? s : null;
  } catch {
    return null;
  }
}
