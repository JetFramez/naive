export interface ConsumeResult {
  readonly allowed: boolean;
  /** Points left after this request (0 when rejected). */
  readonly remaining: number;
  /** Milliseconds until the window resets (fixed/sliding) or the bucket is full again (token bucket). */
  readonly resetMs: number;
  /** Present only when `allowed` is `false`: how long to wait before retrying. */
  readonly retryAfterMs?: number;
}

export type Algorithm = "fixed" | "sliding" | "token-bucket";

export interface ConsumeArgs {
  /** Fully prefixed key (`name:key`). */
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly cost: number;
  readonly now: number;
}

/**
 * The subset of a Redis client the Redis backend needs: `eval` in the
 * ioredis calling convention. `ioredis` satisfies it directly.
 */
export interface RedisLike {
  eval(script: string, numKeys: number, ...keysAndArgs: Array<string | number>): Promise<unknown>;
}

/** Redis returns Lua numbers as integers; scripts return floats as strings, so parse both. */
export function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}
