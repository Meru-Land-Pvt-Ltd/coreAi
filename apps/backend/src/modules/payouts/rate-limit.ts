const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Small in-process rate limiter for payout mutations and link creation.
 * Sufficient for the single-process production deployment; a shared store
 * would be needed for multi-instance scaling.
 */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

// Bound memory: sweep expired buckets occasionally.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();
