import { $ as log, it as parseDuration, x as TooManyRequests } from "./dist-BLfGRdiS.js";
//#region ../rate-limit/dist/index.js
/** Redis returns Lua numbers as integers; scripts return floats as strings, so parse both. */
function num(value) {
	return typeof value === "number" ? value : Number(value);
}
/**
* Fixed window: one counter per `floor(now / window)`, expiring at the
* boundary. Increment first, then decide from the returned total, so two
* concurrent requests can never both see the same count.
*/
function bucketOf(args) {
	const bucket = Math.floor(args.now / args.windowMs);
	return {
		key: `${args.key}:fixed:${bucket}`,
		resetMs: (bucket + 1) * args.windowMs - args.now
	};
}
function decide$2(total, args, resetMs) {
	const allowed = total <= args.limit;
	return allowed ? {
		allowed,
		remaining: args.limit - total,
		resetMs
	} : {
		allowed,
		remaining: 0,
		resetMs,
		retryAfterMs: resetMs
	};
}
function fixedMemory(store, args) {
	const { key, resetMs } = bucketOf(args);
	const total = (store.get(key, args.now) ?? 0) + args.cost;
	store.set(key, total, resetMs, args.now);
	return decide$2(total, args, resetMs);
}
const FIXED_LUA = `
local total = redis.call('INCRBY', KEYS[1], ARGV[1])
if total == tonumber(ARGV[1]) then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
local ttl = redis.call('PTTL', KEYS[1])
return { total, ttl }
`;
async function fixedRedis(client, args) {
	const { key, resetMs } = bucketOf(args);
	const reply = await client.eval(FIXED_LUA, 1, key, args.cost, Math.max(resetMs, 1));
	const ttl = num(reply[1]);
	return decide$2(num(reply[0]), args, ttl > 0 ? ttl : resetMs);
}
/**
* Sliding window: this bucket's count plus the previous bucket's count
* weighted by how much of it still overlaps the trailing window. Increments
* the current bucket first, then decides from the returned total.
*/
function bucketsOf(args) {
	const bucket = Math.floor(args.now / args.windowMs);
	const elapsed = args.now - bucket * args.windowMs;
	return {
		current: `${args.key}:sliding:${bucket}`,
		previous: `${args.key}:sliding:${bucket - 1}`,
		previousWeight: 1 - elapsed / args.windowMs,
		resetMs: args.windowMs - elapsed
	};
}
function decide$1(current, previous, weight, args, resetMs) {
	const weighted = previous * weight + current;
	const allowed = weighted <= args.limit;
	return allowed ? {
		allowed,
		remaining: Math.floor(args.limit - weighted),
		resetMs
	} : {
		allowed,
		remaining: 0,
		resetMs,
		retryAfterMs: resetMs
	};
}
function slidingMemory(store, args) {
	const { current, previous, previousWeight, resetMs } = bucketsOf(args);
	const total = (store.get(current, args.now) ?? 0) + args.cost;
	store.set(current, total, args.windowMs * 2, args.now);
	return decide$1(total, store.get(previous, args.now) ?? 0, previousWeight, args, resetMs);
}
const SLIDING_LUA = `
local current = redis.call('INCRBY', KEYS[1], ARGV[1])
if current == tonumber(ARGV[1]) then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
return { current, previous }
`;
async function slidingRedis(client, args) {
	const { current, previous, previousWeight, resetMs } = bucketsOf(args);
	const reply = await client.eval(SLIDING_LUA, 2, current, previous, args.cost, args.windowMs * 2);
	return decide$1(num(reply[0]), num(reply[1]), previousWeight, args, resetMs);
}
/**
* Token bucket: `limit` tokens, refilled continuously at `limit / window`,
* spent `cost` at a time. Unused capacity carries forward up to `limit`, so
* bursts are fine as long as the average rate stays within budget.
*/
function decide(tokensBefore, args) {
	const rate = args.limit / args.windowMs;
	if (tokensBefore < args.cost) return {
		allowed: false,
		remaining: Math.floor(tokensBefore),
		resetMs: Math.ceil((args.limit - tokensBefore) / rate),
		retryAfterMs: Math.ceil((args.cost - tokensBefore) / rate),
		tokensAfter: tokensBefore
	};
	const after = tokensBefore - args.cost;
	return {
		allowed: true,
		remaining: Math.floor(after),
		resetMs: Math.ceil((args.limit - after) / rate),
		tokensAfter: after
	};
}
function tokenBucketMemory(store, args) {
	const key = `${args.key}:bucket`;
	const rate = args.limit / args.windowMs;
	const stored = store.get(key, args.now);
	const elapsed = stored ? args.now - stored.updatedAt : 0;
	const { tokensAfter, ...result } = decide(Math.min(args.limit, (stored?.tokens ?? args.limit) + elapsed * rate), args);
	store.set(key, {
		tokens: tokensAfter,
		updatedAt: args.now
	}, args.windowMs, args.now);
	return result;
}
const TOKEN_BUCKET_LUA = `
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
async function tokenBucketRedis(client, args) {
	const key = `${args.key}:bucket`;
	const reply = await client.eval(TOKEN_BUCKET_LUA, 1, key, args.cost, args.limit, args.windowMs, args.now);
	const allowed = num(reply[0]) === 1;
	const tokensAfter = num(reply[1]);
	const { tokensAfter: _ignored, ...result } = decide(allowed ? tokensAfter + args.cost : tokensAfter, args);
	return result;
}
/**
* The in-process backend: a `Map` with lazy expiry. Every read-modify-write
* in the algorithms happens synchronously against it, with no `await` in
* between, so it is atomic within a single process.
*/
var MemoryStore = class {
	#entries = /* @__PURE__ */ new Map();
	#sweeps = 0;
	get(key, now) {
		const entry = this.#entries.get(key);
		if (!entry) return void 0;
		if (entry.expiresAt <= now) {
			this.#entries.delete(key);
			return;
		}
		return entry.value;
	}
	set(key, value, ttlMs, now) {
		this.#entries.set(key, {
			value,
			expiresAt: now + ttlMs
		});
		if (++this.#sweeps % 1e3 === 0) this.sweep(now);
	}
	sweep(now) {
		for (const [key, entry] of this.#entries) if (entry.expiresAt <= now) this.#entries.delete(key);
	}
	get size() {
		return this.#entries.size;
	}
};
const MEMORY = {
	fixed: fixedMemory,
	sliding: slidingMemory,
	"token-bucket": tokenBucketMemory
};
const REDIS = {
	fixed: fixedRedis,
	sliding: slidingRedis,
	"token-bucket": tokenBucketRedis
};
/** Picks the backend once; every request then goes through the returned `consume`. */
function createConsumer(options) {
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
			log.warn({
				err: error,
				key: args.key
			}, "rate limit: redis unavailable, falling back to memory");
			return viaMemory(memory, args);
		}
	};
}
/**
* Rate limits requests. Sets `RateLimit-Limit`, `RateLimit-Remaining` and
* `RateLimit-Reset` on every response the limiter sees; throws
* `TooManyRequests` (429, with `Retry-After`) once the limit is exceeded.
* Atomic on both backends: memory decides synchronously, Redis runs one Lua
* script per decision.
*/
function rateLimit(options) {
	const { limit } = options;
	const windowMs = parseDuration(options.window ?? "1m", "rate-limit window");
	const prefix = options.name ?? "notio-rate-limit";
	const consume = createConsumer({
		algorithm: options.algorithm ?? "fixed",
		redis: options.store,
		fallback: options.fallback
	});
	const keyOf = options.key ?? ((ctx) => ctx.ip);
	return async (ctx, next) => {
		if (options.skip && await options.skip(ctx)) {
			await next();
			return;
		}
		const key = keyOf(ctx);
		if (key === null || key === void 0) {
			await next();
			return;
		}
		const cost = typeof options.cost === "function" ? await options.cost(ctx) : options.cost ?? 1;
		const result = await consume({
			key: `${prefix}:${key}`,
			limit,
			windowMs,
			cost,
			now: Date.now()
		});
		ctx.set("RateLimit-Limit", String(limit));
		ctx.set("RateLimit-Remaining", String(Math.max(result.remaining, 0)));
		ctx.set("RateLimit-Reset", String(Math.ceil(result.resetMs / 1e3)));
		if (!result.allowed) {
			const retryAfter = Math.ceil((result.retryAfterMs ?? result.resetMs) / 1e3);
			ctx.set("Retry-After", String(retryAfter));
			await options.onLimited?.(ctx, {
				limit,
				window: windowMs,
				retryAfter,
				key
			});
			throw new TooManyRequests(void 0, {
				limit,
				window: windowMs,
				retryAfter
			});
		}
		await next();
	};
}
//#endregion
export { FIXED_LUA, MemoryStore, SLIDING_LUA, TOKEN_BUCKET_LUA, createConsumer, fixedMemory, fixedRedis, rateLimit, slidingMemory, slidingRedis, tokenBucketMemory, tokenBucketRedis };
