import type { MemoryStore } from "../memory.js";
import { type ConsumeArgs, type ConsumeResult, num, type RedisLike } from "../types.js";

/**
 * Fixed window: one counter per `floor(now / window)`, expiring at the
 * boundary. Increment first, then decide from the returned total, so two
 * concurrent requests can never both see the same count.
 */
function bucketOf(args: ConsumeArgs) {
  const bucket = Math.floor(args.now / args.windowMs);
  return { key: `${args.key}:fixed:${bucket}`, resetMs: (bucket + 1) * args.windowMs - args.now };
}

function decide(total: number, args: ConsumeArgs, resetMs: number): ConsumeResult {
  const allowed = total <= args.limit;
  return allowed
    ? { allowed, remaining: args.limit - total, resetMs }
    : { allowed, remaining: 0, resetMs, retryAfterMs: resetMs };
}

export function fixedMemory(store: MemoryStore, args: ConsumeArgs): ConsumeResult {
  const { key, resetMs } = bucketOf(args);
  const total = (store.get<number>(key, args.now) ?? 0) + args.cost;
  store.set(key, total, resetMs, args.now);
  return decide(total, args, resetMs);
}

export const FIXED_LUA = `
local total = redis.call('INCRBY', KEYS[1], ARGV[1])
if total == tonumber(ARGV[1]) then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
local ttl = redis.call('PTTL', KEYS[1])
return { total, ttl }
`;

export async function fixedRedis(client: RedisLike, args: ConsumeArgs): Promise<ConsumeResult> {
  const { key, resetMs } = bucketOf(args);
  const reply = (await client.eval(
    FIXED_LUA,
    1,
    key,
    args.cost,
    Math.max(resetMs, 1),
  )) as unknown[];
  const ttl = num(reply[1]);
  return decide(num(reply[0]), args, ttl > 0 ? ttl : resetMs);
}
