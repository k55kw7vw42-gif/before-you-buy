/**
 * Fixed-window in-memory rate limiter for the analysis endpoints.
 *
 * Deliberately simple: a single-process counter is enough for this MVP. For a
 * multi-instance deployment, swap the Map for Redis behind the same function
 * signature.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const globalForLimiter = globalThis as unknown as { __bypBuckets?: Map<string, Bucket> };
const buckets = (globalForLimiter.__bypBuckets ??= new Map<string, Bucket>());

const MAX = Number(process.env.RATE_LIMIT_MAX ?? 10);
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, max = MAX, windowMs = WINDOW_MS): RateLimitResult {
  const now = Date.now();

  // Opportunistic cleanup so the map cannot grow without bound.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, remaining: max - bucket.count, retryAfterSeconds: 0 };
}

/** Prefers the authenticated user id, falling back to the client IP. */
export function rateLimitKey(request: Request, userId: string | null): string {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `ip:${ip}`;
}
