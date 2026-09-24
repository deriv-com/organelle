/** Per-replica in-memory sliding-window rate limit (audit S9). */

type Bucket = {
  windowStartMs: number;
  count: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStartMs >= windowMs) {
    buckets.set(key, { windowStartMs: now, count: 1 });
    return { ok: true };
  }

  if (bucket.count >= limit) {
    const retryAfterSec = Math.ceil((bucket.windowStartMs + windowMs - now) / 1000);
    return { ok: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }

  bucket.count += 1;
  return { ok: true };
}

export function clearRateLimitBuckets() {
  buckets.clear();
}
