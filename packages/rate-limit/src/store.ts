import { log } from "@naive-internal/core";
import { fixedMemory, fixedRedis } from "./algorithms/fixed.js";
import { slidingMemory, slidingRedis } from "./algorithms/sliding.js";
import { tokenBucketMemory, tokenBucketRedis } from "./algorithms/token-bucket.js";
import { MemoryStore } from "./memory.js";
import type { Algorithm, ConsumeArgs, ConsumeResult, RedisLike } from "./types.js";

export type Consume = (args: ConsumeArgs) => Promise<ConsumeResult>;

export interface BackendOptions {
  readonly algorithm: Algorithm;
  readonly redis?: RedisLike | undefined;
  /**
   * When Redis throws (connection down, timeout), decide from an in-process
   * copy for that request instead of failing it. Default `true`; `false`
   * fails closed with the Redis error.
   */
  readonly fallback?: boolean | undefined;
}

const MEMORY = {
  fixed: fixedMemory,
  sliding: slidingMemory,
  "token-bucket": tokenBucketMemory,
} as const;

const REDIS = {
  fixed: fixedRedis,
  sliding: slidingRedis,
  "token-bucket": tokenBucketRedis,
} as const;

/** Picks the backend once; every request then goes through the returned `consume`. */
export function createConsumer(options: BackendOptions): Consume {
  const memory = new MemoryStore();
  const viaMemory = MEMORY[options.algorithm];
  const redis = options.redis;
  if (!redis) return async (args) => viaMemory(memory, args);

  const viaRedis = REDIS[options.algorithm];
  const fallback = options.fallback ?? true;
  return async (args) => {
    try {
      return await viaRedis(redis, args);
    } catch (error) {
      if (!fallback) throw error;
      log.warn(
        { err: error, key: args.key },
        "rate limit: redis unavailable, falling back to memory",
      );
      return viaMemory(memory, args);
    }
  };
}
