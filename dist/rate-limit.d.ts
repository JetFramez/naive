import { x as Ctx, xt as Middleware, yt as MaybePromise } from "./index-GUzomrOd.js";
//#region ../rate-limit/dist/index.d.ts
//#region src/memory.d.ts
/**
 * The in-process backend: a `Map` with lazy expiry. Every read-modify-write
 * in the algorithms happens synchronously against it, with no `await` in
 * between, so it is atomic within a single process.
 */
export declare class MemoryStore {
  #private;
  get<T>(key: string, now: number): T | undefined;
  set(key: string, value: unknown, ttlMs: number, now: number): void;
  sweep(now: number): void;
  get size(): number;
}
//#endregion
//#region src/types.d.ts
interface ConsumeResult {
  readonly allowed: boolean;
  /** Points left after this request (0 when rejected). */
  readonly remaining: number;
  /** Milliseconds until the window resets (fixed/sliding) or the bucket is full again (token bucket). */
  readonly resetMs: number;
  /** Present only when `allowed` is `false`: how long to wait before retrying. */
  readonly retryAfterMs?: number;
}
type Algorithm = "fixed" | "sliding" | "token-bucket";
interface ConsumeArgs {
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
interface RedisLike {
  eval(script: string, numKeys: number, ...keysAndArgs: Array<string | number>): Promise<unknown>;
}
//#endregion
//#region src/algorithms/fixed.d.ts
export declare function fixedMemory(store: MemoryStore, args: ConsumeArgs): ConsumeResult;
export declare const FIXED_LUA = "\nlocal total = redis.call('INCRBY', KEYS[1], ARGV[1])\nif total == tonumber(ARGV[1]) then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end\nlocal ttl = redis.call('PTTL', KEYS[1])\nreturn { total, ttl }\n";
export declare function fixedRedis(client: RedisLike, args: ConsumeArgs): Promise<ConsumeResult>;
//#endregion
//#region src/algorithms/sliding.d.ts
export declare function slidingMemory(store: MemoryStore, args: ConsumeArgs): ConsumeResult;
export declare const SLIDING_LUA = "\nlocal current = redis.call('INCRBY', KEYS[1], ARGV[1])\nif current == tonumber(ARGV[1]) then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end\nlocal previous = tonumber(redis.call('GET', KEYS[2]) or '0')\nreturn { current, previous }\n";
export declare function slidingRedis(client: RedisLike, args: ConsumeArgs): Promise<ConsumeResult>;
//#endregion
//#region src/algorithms/token-bucket.d.ts
export declare function tokenBucketMemory(store: MemoryStore, args: ConsumeArgs): ConsumeResult;
export declare const TOKEN_BUCKET_LUA = "\nlocal cost = tonumber(ARGV[1])\nlocal capacity = tonumber(ARGV[2])\nlocal window = tonumber(ARGV[3])\nlocal now = tonumber(ARGV[4])\nlocal rate = capacity / window\nlocal data = redis.call('HMGET', KEYS[1], 't', 'u')\nlocal tokens = tonumber(data[1])\nlocal updated = tonumber(data[2])\nif tokens == nil then tokens = capacity end\nif updated == nil then updated = now end\ntokens = math.min(capacity, tokens + (now - updated) * rate)\nlocal allowed = 0\nif tokens >= cost then\n  tokens = tokens - cost\n  allowed = 1\nend\nredis.call('HSET', KEYS[1], 't', tostring(tokens), 'u', tostring(now))\nredis.call('PEXPIRE', KEYS[1], window)\nreturn { allowed, tostring(tokens) }\n";
export declare function tokenBucketRedis(client: RedisLike, args: ConsumeArgs): Promise<ConsumeResult>;
//#endregion
//#region src/rate-limit.d.ts
interface RateLimitInfo {
  readonly limit: number;
  /** Milliseconds. */
  readonly window: number;
  /** Seconds, matching the `Retry-After` header convention. */
  readonly retryAfter: number;
  readonly key: string;
}
interface RateLimitOptions {
  readonly limit: number;
  /** Milliseconds or a duration string. Default `"1m"`. */
  readonly window?: number | string;
  /** Groups requests into a bucket. Default `ctx.ip`. Returning `null`/`undefined` skips the limit. */
  readonly key?: (ctx: Ctx) => string | null | undefined;
  /** Return `true` to bypass the limit entirely (health checks, trusted callers). */
  readonly skip?: (ctx: Ctx) => MaybePromise<boolean>;
  /** Points this request consumes. Default `1`. */
  readonly cost?: number | ((ctx: Ctx) => MaybePromise<number>);
  /** Default `"fixed"`. */
  readonly algorithm?: Algorithm;
  /**
   * A Redis client (`ioredis`, or anything with an ioredis-style `eval`).
   * Omit it for in-process memory. Share one client across several
   * `rateLimit()` calls freely; `name` keeps their keys apart.
   */
  readonly store?: RedisLike;
  /** Namespaces this limiter's keys. Default `"notio-rate-limit"`. */
  readonly name?: string;
  /** With a Redis store: fall back to memory for a request when Redis errors. Default `true`. */
  readonly fallback?: boolean;
  readonly onLimited?: (ctx: Ctx, info: RateLimitInfo) => MaybePromise<void>;
}
/**
 * Rate limits requests. Sets `RateLimit-Limit`, `RateLimit-Remaining` and
 * `RateLimit-Reset` on every response the limiter sees; throws
 * `TooManyRequests` (429, with `Retry-After`) once the limit is exceeded.
 * Atomic on both backends: memory decides synchronously, Redis runs one Lua
 * script per decision.
 */
export declare function rateLimit(options: RateLimitOptions): Middleware;
//#endregion
//#region src/store.d.ts
type Consume = (args: ConsumeArgs) => Promise<ConsumeResult>;
interface BackendOptions {
  readonly algorithm: Algorithm;
  readonly redis?: RedisLike | undefined;
  /**
   * When Redis throws (connection down, timeout), decide from an in-process
   * copy for that request instead of failing it. Default `true`; `false`
   * fails closed with the Redis error.
   */
  readonly fallback?: boolean | undefined;
}
/** Picks the backend once; every request then goes through the returned `consume`. */
export declare function createConsumer(options: BackendOptions): Consume;
//#endregion
export type { Algorithm, BackendOptions, Consume, ConsumeArgs, ConsumeResult, RateLimitInfo, RateLimitOptions, RedisLike };