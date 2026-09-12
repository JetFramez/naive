import type { MemoryStore } from "../memory.js";
import { type ConsumeArgs, type ConsumeResult, num, type RedisLike } from "../types.js";

/**
 * Sliding window: this bucket's count plus the previous bucket's count
 * weighted by how much of it still overlaps the trailing window. Increments
 * the current bucket first, then decides from the returned total.
 */
function bucketsOf(args: ConsumeArgs) {
  const bucket = Math.floor(args.now / args.windowMs);
  const elapsed = args.now - bucket * args.windowMs;
  return {
    current: `${args.key}:sliding:${bucket}`,
    previous: `${args.key}:sliding:${bucket - 1}`,
    previousWeight: 1 - elapsed / args.windowMs,
    resetMs: args.windowMs - elapsed,
  };
}

function decide(
  current: number,
  previous: number,
  weight: number,
  args: ConsumeArgs,
  resetMs: number,
): ConsumeResult {
  const weighted = previous * weight + current;
  const allowed = weighted <= args.limit;
  return allowed
    ? { allowed, remaining: Math.floor(args.limit - weighted), resetMs }
    : { allowed, remaining: 0, resetMs, retryAfterMs: resetMs };
}

export function slidingMemory(store: MemoryStore, args: ConsumeArgs): ConsumeResult {
  const { current, previous, previousWeight, resetMs } = bucketsOf(args);
  const total = (store.get<number>(current, args.now) ?? 0) + args.cost;
  store.set(current, total, args.windowMs * 2, args.now);
  const prev = store.get<number>(previous, args.now) ?? 0;
  return decide(total, prev, previousWeight, args, resetMs);
}

export const SLIDING_LUA = `
local current = redis.call('INCRBY', KEYS[1], ARGV[1])
if current == tonumber(ARGV[1]) then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
return { current, previous }
`;

export async function slidingRedis(client: RedisLike, args: ConsumeArgs): Promise<ConsumeResult> {
  const { current, previous, previousWeight, resetMs } = bucketsOf(args);
  const reply = (await client.eval(
    SLIDING_LUA,
    2,
    current,
    previous,
    args.cost,
    args.windowMs * 2,
  )) as unknown[];
  return decide(num(reply[0]), num(reply[1]), previousWeight, args, resetMs);
}
