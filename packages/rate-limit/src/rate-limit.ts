import type { Ctx, MaybePromise, Middleware } from "@notio-internal/core";
import { parseDuration, TooManyRequests } from "@notio-internal/core";
import Keyv, { type KeyvStoreAdapter } from "keyv";
import { ALGORITHMS, type Algorithm } from "./algorithms.js";

export interface RateLimitInfo {
  readonly limit: number;
  /** Milliseconds. */
  readonly window: number;
  /** Seconds, matching the `Retry-After` header convention. */
  readonly retryAfter: number;
  readonly key: string;
}

export interface RateLimitOptions {
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
  /** A Keyv store adapter; memory by default. Share one store across several `rateLimit()` calls freely, distinguished by `name`. */
  readonly store?: KeyvStoreAdapter;
  /** Namespaces this limiter's keys when a store is shared. Default `"notio-rate-limit"`. */
  readonly name?: string;
  readonly onLimited?: (ctx: Ctx, info: RateLimitInfo) => MaybePromise<void>;
}

/**
 * Rate limits requests. Sets `RateLimit-Limit`, `RateLimit-Remaining` and
 * `RateLimit-Reset` on every response the limiter sees; throws
 * `TooManyRequests` (429, with `Retry-After`) once the limit is exceeded.
 */
export function rateLimit(options: RateLimitOptions): Middleware {
  const { limit } = options;
  const windowMs = parseDuration(options.window ?? "1m", "rate-limit window");
  const consume = ALGORITHMS[options.algorithm ?? "fixed"];
  const store = new Keyv({
    ...(options.store ? { store: options.store } : {}),
    namespace: options.name ?? "notio-rate-limit",
  });
  const keyOf = options.key ?? ((ctx: Ctx) => ctx.ip);

  return async (ctx, next) => {
    if (options.skip && (await options.skip(ctx))) {
      await next();
      return;
    }
    const key = keyOf(ctx);
    if (key === null || key === undefined) {
      await next();
      return;
    }
    const cost = typeof options.cost === "function" ? await options.cost(ctx) : (options.cost ?? 1);
    const result = await consume({ store, key, limit, windowMs, cost });

    ctx.set("RateLimit-Limit", String(limit));
    ctx.set("RateLimit-Remaining", String(Math.max(result.remaining, 0)));
    ctx.set("RateLimit-Reset", String(Math.ceil(result.resetMs / 1000)));

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.retryAfterMs ?? result.resetMs) / 1000);
      ctx.set("Retry-After", String(retryAfter));
      await options.onLimited?.(ctx, { limit, window: windowMs, retryAfter, key });
      throw new TooManyRequests(undefined, { limit, window: windowMs, retryAfter });
    }
    await next();
  };
}
