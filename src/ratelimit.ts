export interface RateLimiterOptions {
  capacity: number;
  refillPerSec: number;
  now?: () => number;
}

export interface RateLimiter {
  take(key: string): boolean;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export function createRateLimiter({
  capacity,
  refillPerSec,
  now = Date.now,
}: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, Bucket>();

  // Periodically evict buckets that have been full (i.e., untouched) for a
  // while, so memory doesn't grow unboundedly for a long-running process
  // fielding many distinct keys. unref() so this timer never keeps the
  // process alive on its own (important for tests and clean shutdown).
  const sweepIntervalMs = 60_000;
  const staleAfterMs = 5 * 60_000;
  const sweepTimer = setInterval(() => {
    const nowMs = now();

    for (const [key, bucket] of buckets) {
      if (nowMs - bucket.lastRefillMs > staleAfterMs) {
        buckets.delete(key);
      }
    }
  }, sweepIntervalMs);
  sweepTimer.unref?.();

  return {
    take(key: string): boolean {
      const nowMs = now();
      let bucket = buckets.get(key);

      if (!bucket) {
        bucket = { tokens: capacity, lastRefillMs: nowMs };
        buckets.set(key, bucket);
      } else {
        const elapsedSec = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000);
        bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
        bucket.lastRefillMs = nowMs;
      }

      if (bucket.tokens < 1) {
        return false;
      }

      bucket.tokens -= 1;
      return true;
    },
  };
}

// Generated once per process start and never persisted or logged. Raw client
// addresses live only long enough to be transformed into an HMAC bucket key.
const PROCESS_SECRET = crypto.getRandomValues(new Uint8Array(32));

export function hashClientKey(rawKey: string): string {
  const hasher = new Bun.CryptoHasher("sha256", PROCESS_SECRET);
  hasher.update(rawKey);
  return hasher.digest("hex");
}
