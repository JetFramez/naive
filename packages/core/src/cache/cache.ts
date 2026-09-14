import { Keyv, type KeyvStoreAdapter } from "keyv";
import { parseDuration } from "../util/duration.js";

export interface CacheOptions {
  /** A Keyv store adapter. Defaults to an in-memory Map. */
  store?: KeyvStoreAdapter | undefined;
  /** Key prefix (Keyv namespace). Default `"naive"`. */
  prefix?: string | undefined;
  /** Default TTL for `set` when none is given. Milliseconds or a duration string. */
  ttl?: number | string | undefined;
  /** Registers `close()` as a shutdown hook when given the app. */
  app?: { onShutdown(hook: () => Promise<void> | void): unknown } | undefined;
}

export interface SetOptions {
  ttl?: number | string | undefined;
}

export interface CacheScope {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, options?: SetOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  /** Returns the cached value or computes, stores and returns it. Concurrent misses share one computation. */
  remember<T>(
    key: string,
    ttl: number | string | undefined,
    compute: () => Promise<T> | T,
  ): Promise<T>;
}

export interface TaggedCache extends CacheScope {
  /** Deletes every entry set through this tag scope. */
  flush(): Promise<void>;
}

export interface Cache extends CacheScope {
  clear(): Promise<void>;
  /** A scope whose `set` and `remember` associate entries with the tags. */
  tags(...tags: string[]): TaggedCache;
  /** Disconnects the store. */
  close(): Promise<void>;
  readonly keyv: Keyv;
}

const TAG_PREFIX = "~tag:";

function ttlMs(ttl: number | string | undefined, fallback: number | undefined): number | undefined {
  return ttl === undefined ? fallback : parseDuration(ttl, "cache ttl");
}

/**
 * Creates a cache on Keyv. Memory by default; pass a store such as
 * `await redisStore(url)` for Redis.
 */
export function createCache(options: CacheOptions = {}): Cache {
  const keyv = new Keyv({
    ...(options.store ? { store: options.store } : {}),
    namespace: options.prefix ?? "naive",
  });
  const defaultTtl = ttlMs(options.ttl, undefined);
  const inFlight = new Map<string, Promise<unknown>>();

  const tagKeys = async (tag: string): Promise<string[]> =>
    (await keyv.get<string[]>(TAG_PREFIX + tag)) ?? [];

  const associate = async (tags: readonly string[], key: string): Promise<void> => {
    for (const tag of tags) {
      const keys = await tagKeys(tag);
      if (!keys.includes(key)) await keyv.set(TAG_PREFIX + tag, [...keys, key]);
    }
  };

  const scope = (tags: readonly string[]): CacheScope => ({
    get: (key) => keyv.get(key),
    async set(key, value, opts = {}) {
      await keyv.set(key, value, ttlMs(opts.ttl, defaultTtl));
      if (tags.length > 0) await associate(tags, key);
    },
    delete: (key) => keyv.delete(key),
    has: (key) => keyv.has(key),
    async remember(key, ttl, compute) {
      const hit = await keyv.get(key);
      if (hit !== undefined) return hit as never;
      const pending = inFlight.get(key);
      if (pending) return pending as never;
      const promise = (async () => {
        try {
          const value = await compute();
          await keyv.set(key, value, ttlMs(ttl, defaultTtl));
          if (tags.length > 0) await associate(tags, key);
          return value;
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, promise);
      return promise;
    },
  });

  const cache: Cache = {
    ...scope([]),
    keyv,
    clear: () => keyv.clear(),
    tags(...tags) {
      return {
        ...scope(tags),
        async flush() {
          for (const tag of tags) {
            for (const key of await tagKeys(tag)) await keyv.delete(key);
            await keyv.delete(TAG_PREFIX + tag);
          }
        },
      };
    },
    close: () => keyv.disconnect(),
  };

  options.app?.onShutdown(() => cache.close());
  return cache;
}

/**
 * A Redis store for {@link createCache}. Requires the optional `@keyv/redis`
 * package, imported lazily.
 */
export async function redisStore(
  url: string,
  options?: Record<string, unknown>,
): Promise<KeyvStoreAdapter> {
  let mod: { default: new (url: string, options?: unknown) => KeyvStoreAdapter };
  try {
    mod = (await import("@keyv/redis")) as unknown as typeof mod;
  } catch {
    throw new Error(
      'Redis cache store requires the optional package "@keyv/redis": pnpm add @keyv/redis',
    );
  }
  return new mod.default(url, options);
}
