// The searching user's IP and our site's host, as Aviasales requires on each search.

import type { AviasalesClient } from "@/lib/providers/aviasales";

export function clientOf(request: Request): AviasalesClient {
  const h = request.headers;
  // On Vercel the first x-forwarded-for entry is the user's own address.
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "127.0.0.1";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  return { ip, host: host.split(":")[0] };
}
