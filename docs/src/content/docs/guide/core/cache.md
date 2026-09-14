---
title: Cache
---

A small cache API on Keyv. Memory by default; Redis through the optional `@keyv/redis` package.

```ts
import { createCache, redisStore } from "@jetframez/naive";

export const cache = createCache({ prefix: "shop", ttl: "5m", app });
// or: createCache({ store: await redisStore(config.redis.url), prefix: "shop" })

await cache.set("product:1", product, { ttl: "1h" });
const product = await cache.get<Product>("product:1");
await cache.delete("product:1");
await cache.has("product:1");
await cache.clear();
```

Every TTL is milliseconds or a duration string. `ttl` in the options is the default for `set` and `remember`; without it entries do not expire. `prefix` namespaces keys, which matters when a Redis instance is shared. Passing `app` registers `close()` as a shutdown hook; otherwise call `cache.close()` yourself.

## `remember`

```ts
const products = await cache.remember("products:featured", "10m", () => db.products.featured());
```

Returns the cached value, or computes, stores and returns it. Concurrent misses for the same key share one in-flight computation, so a cold key under load hits the source once. A computation that throws is not cached and the next call retries.

## Tags

```ts
const scoped = cache.tags("products", `user:${userId}`);
await scoped.set("cart:42", cart);
await scoped.remember("recommendations:42", "1h", compute);

await cache.tags("products").flush();     // removes every entry set through a scope that included "products"
```

A tag is a key set stored alongside the data. `flush()` deletes the listed keys and the set. Reads through a scope are ordinary reads; only `set` and `remember` record the association.

## Redis

```sh
pnpm add @keyv/redis
```

```ts
const cache = createCache({ store: await redisStore("redis://localhost:6379") });
```

`redisStore` imports the package lazily and throws a message with the install command when it is missing.
