// Email-link sign-in through Supabase Auth (no passwords). Supabase sends the email; until a
// custom SMTP sender (e.g. Resend) is set in Supabase, its built-in sender allows only a few
// emails an hour, which is fine for testing.

import { createClient } from "@supabase/supabase-js";

export const authConfigured = () => !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const client = () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function sendSignInLink(email: string, redirectTo: string): Promise<void> {
  const { error } = await client().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
  if (error) throw new Error(error.message);
}

/** The user an access token (from the email link) belongs to, or null if it's invalid or expired. */
export async function userFromToken(accessToken: string): Promise<{ id: string; email: string } | null> {
  const { data, error } = await client().auth.getUser(accessToken);
  if (error || !data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

/** Checks a ?token_hash link (customised email templates) and returns its user. */
export async function userFromTokenHash(tokenHash: string, type: string): Promise<{ id: string; email: string } | null> {
  const otpType = (["magiclink", "signup", "email", "invite"].includes(type) ? type : "email") as "magiclink" | "signup" | "email" | "invite";
  const { data, error } = await client().auth.verifyOtp({ token_hash: tokenHash, type: otpType });
  if (error || !data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

/** Only same-site paths, so the link can't bounce people to another site. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next.slice(0, 500) : "/refund-calculator";
}
