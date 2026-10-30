"use client";

import { useEffect } from "react";

/**
 * If Supabase sends a sign-in link to a page other than /auth/callback (it falls back to the
 * project's Site URL when our callback address isn't on its Redirect URLs list), forward the
 * token there so the sign-in still completes instead of looping back to "send me a link".
 */
export function AuthLinkCatcher() {
  useEffect(() => {
    if (location.pathname === "/auth/callback") return;
    const q = new URLSearchParams(location.search);
    if (/(^|[#&])(access_token|error_code)=/.test(location.hash) || q.has("token_hash")) location.replace(`/auth/callback${location.search}${location.hash}`);
  }, []);
  return null;
}
