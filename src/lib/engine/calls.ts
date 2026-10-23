// Cache-first, counted, concurrency-limited provider calls.

import { createHash } from "node:crypto";
import type { CallContext, ProviderCall } from "@/lib/providers/types";
import { ProviderError } from "@/lib/providers/types";
import type { Store } from "@/lib/store";
import type { CallLogEntry, Settings } from "@/lib/types";

/** JSON with sorted keys so equal requests always hash identically. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function cacheKey(provider: string, endpoint: string, body: unknown): string {
  return createHash("sha256").update(`${provider}|${endpoint}|${stableStringify(body)}`).digest("hex");
}

export function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

export function createCallContext(store: Store, settings: Settings): CallContext {
  const log: CallLogEntry[] = [];
  // One limit per provider: slow Aviasales searches (10–35s each) mustn't hold up Ignav calls.
  const limiters = new Map<string, ReturnType<typeof createLimiter>>();
  const limitFor = (provider: string) => {
    let l = limiters.get(provider);
    if (!l) limiters.set(provider, (l = createLimiter(settings.max_parallel_calls)));
    return l;
  };
  // Identical requests inside one search share a single in-flight call.
  const inflight = new Map<string, ReturnType<CallContext["call"]>>();

  async function doCall(req: ProviderCall, key: string) {
    const started = Date.now();
    const cached = await store.getCache(key);
    if (cached && Date.parse(cached.expires_at) > Date.now()) {
      log.push({ provider: req.provider, endpoint: req.endpoint, label: req.label, cacheHit: true, ok: true, httpStatus: null, latencyMs: Date.now() - started });
      return { raw: cached.raw_response, fetchedAt: cached.fetched_at, fromCache: true };
    }
    try {
      const raw = await limitFor(req.provider)(req.fetcher);
      const fetchedAt = new Date().toISOString();
      await store.putCache({
        cache_key: key,
        provider: req.provider,
        endpoint: req.endpoint,
        request: req.body,
        raw_response: raw,
        fetched_at: fetchedAt,
        expires_at: new Date(Date.now() + (req.ttlMins ?? settings.cache_ttl_mins) * 60_000).toISOString(),
      });
      log.push({ provider: req.provider, endpoint: req.endpoint, label: req.label, cacheHit: false, ok: true, httpStatus: 200, latencyMs: Date.now() - started });
      return { raw, fetchedAt, fromCache: false };
    } catch (err) {
      const e = err as Error;
      log.push({
        provider: req.provider,
        endpoint: req.endpoint,
        label: req.label,
        cacheHit: false,
        ok: false,
        httpStatus: err instanceof ProviderError ? err.httpStatus : null,
        latencyMs: Date.now() - started,
        error: e.message,
      });
      throw err;
    }
  }

  return {
    settings,
    log,
    call(req) {
      const key = cacheKey(req.provider, req.endpoint, req.body);
      let p = inflight.get(key);
      if (!p) {
        p = doCall(req, key);
        inflight.set(key, p);
      }
      return p;
    },
  };
}

/** Successful, non-cached calls — the ones Ignav bills for (Aviasales counts against its hourly limit). */
export function countPaid(log: CallLogEntry[], provider?: CallLogEntry["provider"]): number {
  return log.filter((c) => !c.cacheHit && c.ok && (!provider || c.provider === provider)).length;
}
