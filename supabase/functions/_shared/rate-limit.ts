// V3 AE.5 (owner 2026-09-25, "within reason"): a rate limit on the MCP
// endpoint, per credential. A token bucket: a credential may burst up to
// `capacity` calls and then sustain `refillPerSecond`; past that the call is
// refused with 429 and a Retry-After the client honours (an agent loop backs
// off, a runaway loop stops hurting).
//
// The count lives in the database (owner 2026-09-26, "go with the table"):
// mcp_rate_take on public.mcp_rate_buckets (migration 20260926120000), one
// row per credential, because the hosted runtime spreads a burst over
// several isolates and a count kept in one isolate's memory never filled
// (120 concurrent calls, none refused). `takeRateLimit` asks it once per
// request. When the database cannot answer (the migration not applied yet,
// a transient error) the isolate's own bucket below decides, so the endpoint
// keeps a limit and keeps answering.
export interface RateLimitRule {
  /** Calls a credential may make at once before the rate applies. */
  capacity: number;
  /** Calls per second the bucket refills at (the sustained rate). */
  refillPerSecond: number;
}

/** The MCP endpoint's rule: a burst of 60, then 4 a second (240 a minute). */
export const MCP_RATE_LIMIT: RateLimitRule = { capacity: 60, refillPerSecond: 4 };

export type RateLimitVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  take(key: string): RateLimitVerdict;
  /** How many credentials the limiter remembers (for tests and pruning). */
  size(): number;
  reset(): void;
}

/** The refusal sentence a 429 carries; the numbers are the rule's. */
export function rateLimitMessage(rule: RateLimitRule, retryAfterSeconds: number): string {
  return `This credential made more than ${rule.capacity} calls in a burst; the rate is ${rule.refillPerSecond * 60} a minute. ` +
    `Wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'} and try again.`;
}

const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter(rule: RateLimitRule, opts: { now?: () => number; maxKeys?: number } = {}): RateLimiter {
  const now = opts.now ?? (() => Date.now());
  const maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
  const buckets = new Map<string, { tokens: number; at: number }>();

  const refilled = (b: { tokens: number; at: number }, at: number) =>
    Math.min(rule.capacity, b.tokens + Math.max(0, at - b.at) / 1000 * rule.refillPerSecond);

  const prune = (at: number) => {
    if (buckets.size <= maxKeys) return;
    // A full bucket is a credential that has not called for a while: forget it.
    for (const [key, b] of buckets) if (refilled(b, at) >= rule.capacity) buckets.delete(key);
    // Still over: drop the oldest until under.
    if (buckets.size > maxKeys) {
      const oldest = [...buckets.entries()].sort((x, y) => x[1].at - y[1].at);
      for (const [key] of oldest.slice(0, buckets.size - maxKeys)) buckets.delete(key);
    }
  };

  return {
    take(key) {
      const at = now();
      const b = buckets.get(key) ?? { tokens: rule.capacity, at };
      const tokens = refilled(b, at);
      if (tokens >= 1) {
        buckets.set(key, { tokens: tokens - 1, at });
        prune(at);
        return { allowed: true };
      }
      buckets.set(key, { tokens, at });
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / rule.refillPerSecond)) };
    },
    size: () => buckets.size,
    reset: () => buckets.clear(),
  };
}

/** The one call the shared limit needs: the service-role client's rpc. */
export interface RateLimitStore {
  rpc(fn: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

let warnedFallback = false;

/**
 * Take one call from the credential's bucket in the database, which every
 * isolate shares. `mcp_rate_take` answers 0 to let the call through, or the
 * whole seconds until the next call passes. Any other answer (an error, a
 * missing function) falls back to `fallback`, this isolate's own bucket.
 */
export async function takeRateLimit(
  store: RateLimitStore,
  holder: string,
  userId: string,
  rule: RateLimitRule,
  fallback: RateLimiter,
): Promise<RateLimitVerdict> {
  try {
    const { data, error } = await store.rpc('mcp_rate_take', {
      p_holder: holder,
      p_user_id: userId,
      p_capacity: rule.capacity,
      p_per_second: rule.refillPerSecond,
    });
    if (!error && typeof data === 'number' && Number.isInteger(data) && data >= 0) {
      return data === 0 ? { allowed: true } : { allowed: false, retryAfterSeconds: data };
    }
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn('[rate-limit] mcp_rate_take did not answer; this isolate\'s own bucket decides', error ?? data);
    }
  } catch (e) {
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn('[rate-limit] mcp_rate_take failed; this isolate\'s own bucket decides', e);
    }
  }
  return fallback.take(holder);
}
