# Rate limiting

`@jetframez/notio/rate-limit` limits requests by a key, on a Keyv store — memory by default, Redis through the same `@keyv/redis` adapter the cache module uses.

```ts
import { rateLimit } from "@jetframez/notio/rate-limit";

router.use(rateLimit({ limit: 100, window: "1m" }));

router.post("/login").use(rateLimit({ limit: 5, window: "15m", key: (ctx) => ctx.body?.email ?? ctx.ip }));
```

Every response the limiter sees carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds until the limit resets). Once exceeded, it throws `TooManyRequests` (429) with `details: { limit, window, retryAfter }` and a `Retry-After` header.

## Options

| Option | Default | Meaning |
|---|---|---|
| `limit` | — | Points allowed per window. |
| `window` | `"1m"` | Milliseconds or a duration string. |
| `key` | `ctx.ip` | Groups requests into a bucket. Returning `null`/`undefined` skips the limit for that request entirely. |
| `skip` | — | Return `true` to bypass the limiter (health checks, internal callers). |
| `cost` | `1` | Points this request consumes; a number or `(ctx) => number`. |
| `algorithm` | `"fixed"` | `"fixed"`, `"sliding"`, or `"token-bucket"`. |
| `store` | memory | A Keyv store adapter. `await redisStore(url)` from the cache module works here too. |
| `name` | `"notio-rate-limit"` | Namespaces this limiter's keys, so several `rateLimit()` calls can safely share one store. |
| `onLimited` | — | `(ctx, { limit, window, retryAfter, key }) => void`, called exactly when a request is rejected. |

## Algorithms

- **`fixed`** — a counter per time bucket, reset at the boundary. Cheap and predictable; a burst can land two limits' worth of requests across an adjacent boundary.
- **`sliding`** — the current bucket's count plus a time-weighted fraction of the previous bucket's, approximating a true sliding window without storing a timestamp per request.
- **`token-bucket`** — capacity refills continuously over `window`; unused capacity carries forward up to `limit`, so a client that has been quiet can burst back up to the full limit.

All three read and write through the same Keyv store via a get-then-set, not an atomic increment. Under concurrent requests hitting the same key at the same instant, a Redis-backed store can very briefly allow a few more requests than the configured limit — the same class of tradeoff most non-atomic rate limiters accept in exchange for working against any Keyv-compatible backend. For strict enforcement under heavy concurrency on a single key, put the limiter close to the client (a lower per-key concurrency) or set the limit a little below the true budget.

## Sharing a store across limiters

```ts
const store = await redisStore(config.redis.url);
app.use(rateLimit({ limit: 1000, window: "1m", store, name: "global" }));
router.post("/login").use(rateLimit({ limit: 5, window: "15m", store, name: "login" }));
```

`name` keeps each limiter's keys separate even when they share one underlying store.
