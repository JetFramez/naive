import type { MemoryStore } from "../memory.js";
import { type ConsumeArgs, type ConsumeResult, num, type RedisLike } from "../types.js";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Token bucket: `limit` tokens, refilled continuously at `limit / window`,
 * spent `cost` at a time. Unused capacity carries forward up to `limit`, so
 * bursts are fine as long as the average rate stays within budget.
 */
function decide(tokensBefore: number, args: ConsumeArgs): ConsumeResult & { tokensAfter: number } {
  const rate = args.limit / args.windowMs;
  if (tokensBefore < args.cost) {
    return {
      allowed: false,
      remaining: Math.floor(tokensBefore),
      resetMs: Math.ceil((args.limit - tokensBefore) / rate),
      retryAfterMs: Math.ceil((args.cost - tokensBefore) / rate),
      tokensAfter: tokensBefore,
    };
  }
  const after = tokensBefore - args.cost;
  return {
    allowed: true,
    remaining: Math.floor(after),
    resetMs: Math.ceil((args.limit - after) / rate),
    tokensAfter: after,
  };
}

export function tokenBucketMemory(store: MemoryStore, args: ConsumeArgs): ConsumeResult {
  const key = `${args.key}:bucket`;
  const rate = args.limit / args.windowMs;
  const stored = store.get<Bucket>(key, args.now);
  const elapsed = stored ? args.now - stored.updatedAt : 0;
  const tokensBefore = Math.min(args.limit, (stored?.tokens ?? args.limit) + elapsed * rate);
  const { tokensAfter, ...result } = decide(tokensBefore, args);
  store.set(key, { tokens: tokensAfter, updatedAt: args.now }, args.windowMs, args.now);
  return result;
}

// Redis coerces Lua numbers to integers in replies, so the float token count
// is returned as a string and parsed on the way out.
export const TOKEN_BUCKET_LUA = `
local cost = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local rate = capacity / window
local data = redis.call('HMGET', KEYS[1], 't', 'u')
local tokens = tonumber(data[1])
local updated = tonumber(data[2])
if tokens == nil then tokens = capacity end
if updated == nil then updated = now end
tokens = math.min(capacity, tokens + (now - updated) * rate)
local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end
redis.call('HSET', KEYS[1], 't', tostring(tokens), 'u', tostring(now))
redis.call('PEXPIRE', KEYS[1], window)
return { allowed, tostring(tokens) }
`;

export async function tokenBucketRedis(
  client: RedisLike,
  args: ConsumeArgs,
): Promise<ConsumeResult> {
  const key = `${args.key}:bucket`;
  const reply = (await client.eval(
    TOKEN_BUCKET_LUA,
    1,
    key,
    args.cost,
    args.limit,
    args.windowMs,
    args.now,
  )) as unknown[];
  const allowed = num(reply[0]) === 1;
  const tokensAfter = num(reply[1]);
  // The script already spent the tokens when allowed; reconstruct "before" for a uniform decide().
  const tokensBefore = allowed ? tokensAfter + args.cost : tokensAfter;
  const { tokensAfter: _ignored, ...result } = decide(tokensBefore, args);
  return result;
}
