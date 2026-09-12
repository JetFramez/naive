import type Keyv from "keyv";

export interface ConsumeResult {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Milliseconds until the limit fully resets (fixed/sliding) or a token is available again (token bucket). */
  readonly resetMs: number;
  /** Present only when `allowed` is `false`: how long to wait before retrying. */
  readonly retryAfterMs?: number;
}

export type Algorithm = "fixed" | "sliding" | "token-bucket";

export interface ConsumeOptions {
  readonly store: Keyv;
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly cost: number;
}

/**
 * Fixed window: a counter per `floor(now / windowMs)`, reset at the window
 * boundary. Simple and cheap, but a request right at the boundary can allow
 * up to `2 * limit` requests across the two adjacent windows.
 */
export async function fixedWindow(options: ConsumeOptions): Promise<ConsumeResult> {
  const { store, key, limit, windowMs, cost } = options;
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const resetMs = (bucket + 1) * windowMs - now;
  const storeKey = `${key}:fixed:${bucket}`;
  const used = (await store.get<number>(storeKey)) ?? 0;

  if (used + cost > limit) {
    return { allowed: false, remaining: Math.max(limit - used, 0), resetMs, retryAfterMs: resetMs };
  }
  await store.set(storeKey, used + cost, resetMs);
  return { allowed: true, remaining: limit - used - cost, resetMs };
}

/**
 * Sliding window: the current fixed window's count, plus the previous
 * window's count weighted by how much of it still overlaps. Approximates a
 * true sliding log without keeping a timestamp per request.
 */
export async function slidingWindow(options: ConsumeOptions): Promise<ConsumeResult> {
  const { store, key, limit, windowMs, cost } = options;
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const elapsed = now - bucket * windowMs;
  const previousWeight = 1 - elapsed / windowMs;
  const resetMs = windowMs - elapsed;

  const currentKey = `${key}:sliding:${bucket}`;
  const previousKey = `${key}:sliding:${bucket - 1}`;
  const [current, previous] = await Promise.all([
    store.get<number>(currentKey),
    store.get<number>(previousKey),
  ]);
  const weighted = (previous ?? 0) * previousWeight + (current ?? 0);

  if (weighted + cost > limit) {
    return {
      allowed: false,
      remaining: Math.max(Math.floor(limit - weighted), 0),
      resetMs,
      retryAfterMs: resetMs,
    };
  }
  await store.set(currentKey, (current ?? 0) + cost, windowMs * 2);
  return { allowed: true, remaining: Math.floor(limit - weighted - cost), resetMs };
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Token bucket: `limit` tokens refill continuously over `windowMs`, spent one
 * per point of cost. Unused capacity carries forward (up to `limit`), so
 * bursts are allowed as long as the average rate stays within budget.
 */
export async function tokenBucket(options: ConsumeOptions): Promise<ConsumeResult> {
  const { store, key, limit, windowMs, cost } = options;
  const now = Date.now();
  const refillRate = limit / windowMs;
  const storeKey = `${key}:bucket`;
  const stored = await store.get<Bucket>(storeKey);
  const elapsed = stored ? now - stored.updatedAt : windowMs;
  const tokens = Math.min(limit, (stored?.tokens ?? limit) + elapsed * refillRate);
  const msToFull = (limit - tokens) / refillRate;

  if (tokens < cost) {
    const retryAfterMs = Math.ceil((cost - tokens) / refillRate);
    await store.set(storeKey, { tokens, updatedAt: now }, windowMs);
    return {
      allowed: false,
      remaining: Math.floor(tokens),
      resetMs: Math.ceil(msToFull),
      retryAfterMs,
    };
  }
  const remaining = tokens - cost;
  await store.set(storeKey, { tokens: remaining, updatedAt: now }, windowMs);
  return {
    allowed: true,
    remaining: Math.floor(remaining),
    resetMs: Math.ceil((limit - remaining) / refillRate),
  };
}

export const ALGORITHMS: Record<Algorithm, (options: ConsumeOptions) => Promise<ConsumeResult>> = {
  fixed: fixedWindow,
  sliding: slidingWindow,
  "token-bucket": tokenBucket,
};
