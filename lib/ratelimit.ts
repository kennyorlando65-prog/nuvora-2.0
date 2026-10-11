/**
 * Best-effort request throttling.
 *
 * HONEST SCOPE: this is an IN-MEMORY counter. On a serverless platform each instance has
 * its own memory, so it bounds a burst hitting one instance and does nothing across a
 * fleet. It is a real protection against a naive retry loop or a single abusive client,
 * and it is NOT a substitute for a durable limiter. Before launch, move this to a shared
 * store (Upstash Redis or Vercel KV) keyed the same way - the interface here is what the
 * routes call, so swapping the implementation touches one file.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Bound the map so a flood of unique keys cannot itself become the memory leak. */
const MAX_BUCKETS = 10_000;

function sweep(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still full after sweeping expired buckets: drop the oldest insertions rather than
  // growing without limit.
  if (buckets.size >= MAX_BUCKETS) {
    const excess = buckets.size - MAX_BUCKETS + 1;
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++removed >= excess) break;
    }
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
};

/**
 * Fixed-window limiter. Fixed rather than sliding because a sliding window needs per-request
 * history; the tradeoff is that a client can send up to 2x the limit across a window
 * boundary, which is acceptable for abuse control.
 */
export function rateLimit(args: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): RateLimitResult {
  const now = args.now ?? Date.now();
  sweep(now);

  const existing = buckets.get(args.key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(args.key, { count: 1, resetAt: now + args.windowMs });
    return { allowed: true, remaining: args.limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > args.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return { allowed: true, remaining: args.limit - existing.count, retryAfter: 0 };
}

/**
 * Client identity for rate limiting. Prefers the platform's forwarded header, which the
 * caller cannot forge past the edge proxy, and falls back to a constant so a missing
 * header degrades to a GLOBAL limit rather than no limit at all.
 */
export function clientKeyFrom(headers: Headers, namespace: string): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  const real = headers.get("x-real-ip")?.trim();
  return `${namespace}:${first || real || "unknown"}`;
}
