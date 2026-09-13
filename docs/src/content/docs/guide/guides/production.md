---
title: Production
---

What changes when `NODE_ENV=production`, and what you're responsible for setting up yourself.

## What `NODE_ENV` changes

| Where | Development / anything but `"production"` | Production |
|---|---|---|
| Config file loading ([Config](../../core/config/#where-values-come-from)) | `.env`, `.env.local`, `.env.<env>`, `.env.<env>.local` are read from disk | Files are not read; only `process.env` and `overrides` apply |
| Response validation ([Router](../../core/router/#schemas-query-body-headers-response)) | `.response(schema)` validates the return value, throwing `Internal` on a mismatch | Not validated, no runtime cost |
| Error exposure ([Errors](../../core/errors/#classification)) | `errorHandler({ expose })` defaults to `true` — 500s carry the real message and stack | Defaults to `false` — 500s show "Internal Server Error" |
| Log format ([Logging](../../core/logging/)) | Pretty-printed through `pino-pretty` when stdout is a TTY | One JSON object per line, always |

Set `expose` and `pretty` explicitly if you want different behavior than the default for a given environment — both are ordinary options, not hardcoded to `NODE_ENV`.

## Trust proxy

`ctx.ip` and cookie `secure` detection honor Express's `trust proxy` setting, but notio does not set it for you. Behind a reverse proxy or load balancer, set it on the underlying Express instance:

```ts
app.express.set("trust proxy", 1); // or a specific list of trusted IPs/CIDRs
```

Without this, `ctx.ip` reports the proxy's address, not the client's, and signed cookies may be judged insecure behind TLS-terminating proxies.

## Graceful shutdown and readiness

`createApp`'s default `shutdown.signals: true` handles `SIGTERM` and `SIGINT`: stop accepting new connections, close idle keep-alives, wait up to `shutdown.deadline` (default `"10s"`) for in-flight requests, then close and exit. `/ready` answers `503` for the duration of the drain, so a load balancer configured to poll it stops routing new traffic before the process exits — configure your orchestrator's readiness probe against `/ready`, not `/health`.

Increase `shutdown.deadline` if requests can legitimately run longer than 10 seconds; a request still in flight when the deadline passes has its connection closed.

## Cookie secrets

Signed cookies need `createApp({ cookies: { secret } })`. Passing an array lets you rotate: the first key signs new cookies, every key can still verify older ones. Rotate by prepending the new key, deploying, then removing the old one once its cookies have expired — never remove the only key a live cookie was signed with.

## Redis for rate limiting and cache

Both modules default to in-process memory, which does not coordinate across multiple instances of your app. Behind more than one process — multiple containers, a PM2 cluster, anything horizontally scaled — pass a Redis client to both:

```ts
import Redis from "ioredis";
const redis = new Redis(config.redis.url);

app.use(rateLimit({ limit: 1000, window: "1m", store: redis }));
const cache = createCache({ store: await redisStore(config.redis.url) });
```

See [Rate limiting: Redis](../../modules/rate-limit/#redis-notes) and [Cache: Redis](../../core/cache/#redis). Without this, each instance enforces its own limit and holds its own cache — correct for a single process, surprising once you scale out.

## Log redaction

The default redaction list (`authorization`, `cookie`, `set-cookie`, `password`, `token`, at the top level and one level down) covers common cases but is not exhaustive — add your own paths with `logger: { redact: [...] }` for anything domain-specific (a `ssn` field, an internal API key under a different name) before it ships to a log aggregator you don't fully control.

## Health checks are unauthenticated by design

`/health` and `/ready` are registered before any of your middleware, specifically so authentication or rate limiting can never block them — see [How a request flows](../../getting-started/request-flow/#app-level-registered-at-listen). Don't put anything sensitive in their response; they're meant to be reachable by infrastructure that has no credentials.
