---
title: Guide
---

# notio

A TypeScript web framework on Express 5. Express stays the transport — `app.express` is always the real instance and any `(req, res, next)` middleware works unchanged. On top of it notio adds a typed, chainable router, a per-request context, one error shape, hooks, logging, config, and optional modules for auth, uploads, rate limiting and OpenAPI. Every value you need is on this page; signatures and tables are on the [Reference](/reference) page.

## Install

```sh
pnpm add @jetframez/notio zod
```

Node 22 or later, ESM. Express ships inside the package. Zod is one choice of schema library; Valibot and ArkType work the same way through [Standard Schema](https://standardschema.dev), and notio depends on none of them.

| Import | Adds |
|---|---|
| `@jetframez/notio` | `createApp`, `Router`, `Ctx`, errors, hooks, logging, config, events, cache |
| `@jetframez/notio/auth` | sessions, JWTs, opaque tokens, password hashing |
| `@jetframez/notio/upload` | multipart file uploads |
| `@jetframez/notio/rate-limit` | request rate limiting |
| `@jetframez/notio/openapi` | OpenAPI 3.1 document and docs UI |

## A first app

```ts
import { createApp, NotFound, Router } from "@jetframez/notio";
import { z } from "zod";

const orders = new Router("/orders");

orders.get("/:id").handle((ctx) => {
  const order = db.get(ctx.params.id); // ctx.params.id: string, inferred from ":id"
  if (!order) throw new NotFound(`Order ${ctx.params.id} does not exist`, { id: ctx.params.id });
  return order; // -> 200 JSON
});

orders
  .post("/")
  .body(z.object({ total: z.number().positive() }))
  .handle((ctx) => db.create(ctx.body)); // ctx.body.total: number, validated -> 201 JSON

const app = createApp();
app.mount(orders);
await app.listen(3000);
```

Three things to notice. The body was validated before the handler ran. `ctx.params` and `ctx.body` are typed, not cast. The thrown error and a validation failure both render as the same envelope, with no error code written by you:

```json
{ "code": "NOT_FOUND", "message": "Order 42 does not exist", "details": { "id": "42" }, "requestId": "…" }
```

## createApp

`createApp` builds a real Express app with notio's pieces registered in a fixed order at `listen()`, whatever order you called things in:

1. Context: `ctx`, ambient context, app-level hooks, the request log line.
2. Body parsers. JSON is always on; urlencoded is off unless enabled.
3. `/health` and `/ready`, before any of your middleware so auth can never block them.
4. Your `use`, `mount`, `static` and `redirect` calls, in the order you made them.
5. The 404 handler, then the error handler. Configure it through `app.errors()`; never register your own.

```ts
const app = createApp({
  logger: { level: "info" },
  cookies: { secret: process.env.COOKIE_SECRET },
  body: { json: { limit: "1mb" } },
  shutdown: { deadline: "10s" },
});

app.use(cors(), helmet());              // every request, including unmatched ones
app.mount(orders);                      // at the router's own prefix
app.mount("/api/v1", users, billing);   // under a prefix
app.static("/assets", "./public", { maxAge: "1d" });
app.errors({ expose: process.env.NODE_ENV !== "production" });

app.onStart(() => db.connect());        // before binding
app.onReady(() => log.info("serving")); // after binding; /ready turns 200
app.onShutdown(() => db.close());       // after draining

await app.listen(3000);
await app.close();                      // drain in-flight requests, then close
```

On `SIGTERM` or `SIGINT` the app drains and exits by itself (`shutdown.signals: false` turns that off, for tests). `/ready` answers 503 during startup and again once a drain begins, so a load balancer stops routing traffic before the process exits. Anything you register directly on `app.express` runs before all of the above.

**Existing Express app.** Nothing requires `createApp`. `context()` installs the context middleware, a `Router` is plain Express middleware, and `notFound()` and `errorHandler()` go last:

```ts
app.use(express.json());
app.use(context({ cookieSecret }));
app.use(orders);
app.use(notFound());
app.use(errorHandler());
```

## Router

Declare a path, optional schemas and middleware, then hand it a handler. The router owns the send step: the return value becomes the response.

**Path params** are inferred from the path string, including the router prefix and any group prefixes. Syntax is Express 5: `:name`, `*name`, and `{...}` optional groups.

```ts
new Router("/orgs/:orgId").group("/projects", (r) => {
  r.get("/:projectId").handle((ctx) => ctx.params); // { orgId: string; projectId: string }
});
```

**Schemas.** `.params()`, `.query()`, `.headers()`, `.body()` and `.response()` take any Standard Schema value. Path and query values arrive as strings, so coerce (`z.coerce.number()`). A params schema must declare exactly the path's parameters or it is a compile error naming the offending keys. `.body()` is not offered on `GET`, `DELETE`, `HEAD` or `OPTIONS`. A single query value is promoted to a one-element array when the schema wants one.

::: code-group

```ts [Zod]
router.post("/a").body(z.object({ name: z.string() }));
```

```ts [Valibot]
router.post("/a").body(v.object({ name: v.string() }));
```

```ts [ArkType]
router.post("/a").body(type({ name: "string" }));
```

:::

**Validation** runs after router and group middleware and before route middleware, in the order params, query, headers, uploads, body. Only the first failing section is reported, as a 422:

```json
{ "code": "VALIDATION", "message": "Invalid body",
  "details": { "in": "body", "issues": [{ "path": "items.1.qty", "code": "too_small", "message": "…" }] },
  "requestId": "…" }
```

`.response(schema)` constrains what the handler may return and validates it outside production, throwing `Internal` on a mismatch, so a wrong shape fails loudly in development and costs nothing in production.

**Documentation** on a route is inert at runtime and read by the OpenAPI module: `.summary()`, `.tags()`, `.errors(NotFound, Conflict)`, `.response(status, schema)`, `.deprecated()`, `.hidden()`.

**Groups, mounts, statics, redirects** all inherit the router's prefix and middleware:

```ts
router.group("/admin", [requireAdmin], (r) => { r.get("/stats").handle(...) });
router.mount("/v2", legacy);
router.static("/app", "./dist", { spa: true });
router.redirect("/old", "/new", 301);
```

Router-level middleware compiles per route, so it only runs for requests that match one of the router's routes. Put `cors()` and `helmet()` on the app.

## Context

Every request gets one `ctx`. Handlers and `(ctx, next)` middleware receive it; Express middleware finds it at `res.locals.ctx`.

```ts
ctx.params, ctx.query, ctx.body     // validated by the route's schemas, or raw without one
ctx.headers.get("x-trace")          // request; .set() and .append() write the response
ctx.req, ctx.res                    // the real Express objects, always available
ctx.requestId                       // X-Request-Id, or a generated UUID
ctx.method, ctx.path, ctx.route     // route is the matched pattern, "POST /orders/:id"
ctx.ip, ctx.url                     // ip honours Express `trust proxy`
ctx.state                           // per-request scratch object
ctx.log                             // child logger carrying requestId and route
ctx.bearer()                        // token from "Authorization: Bearer …"
ctx.bind({ orderId })               // adds fields to every later ctx.log line
```

**Cookies.** `ctx.cookies.get/all/set/delete`, plus `setSigned` and `getSigned` (HMAC-SHA256, needs `createApp({ cookies: { secret } })`; pass an array to rotate keys, first signs, all verify). Defaults are `path: "/"`, `httpOnly`, `sameSite: "lax"`, and `secure` on HTTPS.

**Augmenting.** For a field every request carries, merge into the interface. For a field a specific middleware adds, prefer `Middleware<Adds>` (next section), which narrows only what comes after it instead of making the field optional everywhere.

```ts
declare module "@jetframez/notio" {
  interface Ctx { tenant?: Tenant }
}
```

## Middleware

A `Middleware<Adds>` declares what it puts on `ctx`; everything after it in the chain sees those fields as present.

```ts
const authed: Middleware<{ user: User }> = async (ctx, next) => {
  ctx.user = await lookup(ctx.bearer());
  await next();
};

const router = new Router("/orders").use(authed);
router.get("/:id").handle((ctx) => ctx.user.id);       // User, not User | undefined
router.post("/").use(rateLimited).handle((ctx) => ...);  // route-level, after validation
```

::: warning Keep the return value of `.use()`
Narrowing follows the chained value. Discard what `router.use(authed)` returns and the middleware still runs, but later routes are not narrowed.
:::

Express `(req, res, next)` and `(err, req, res, next)` handlers are accepted unchanged and mixed freely; arity is the discriminator. `guard(check, error)` covers one-line checks:

```ts
router.use(cors(), helmet(), authed, guard((ctx) => ctx.user.role === "admin", () => new Forbidden()));
```

Middleware runs outer to inner and unwinds after `await next()`. The router sends after the chain has fully unwound, so headers can still be set after `next()`. A `ctx` middleware must do one of four things: call `next()`, throw, write to `ctx.res`, or return a response descriptor. Doing none of them is a 500.

## Responses

| Handler returns | Response |
|---|---|
| `string` | `text/plain`, 200 |
| object, array, number, boolean, `null` | JSON, 200 (201 for POST) |
| `undefined` | 204, empty |
| `Buffer` or `Readable` | bytes or a stream, `application/octet-stream` unless a type was set |
| already wrote to `ctx.res` | nothing |

`ctx.status(code)` and `ctx.set(name, value)` apply to plain returns. When the conventions are not enough, return a descriptor; its own status and headers win:

```ts
ctx.json(data, { status, headers });   ctx.text(body);           ctx.redirect(url, 302);
ctx.file(path);   ctx.download(path, filename);   ctx.stream(readable, { type });
ctx.empty(204);   ctx.raw((res) => { /* write yourself */ });
```

Descriptors are plain tagged objects, so middleware can return them too.

## Errors

Throw; never call `next(err)`. Every constructor takes `(message?, details?)`.

```ts
throw new NotFound();                                    // 404 NOT_FOUND "Not Found"
throw new Conflict("Email taken", { field: "email" });   // 409 CONFLICT with details
throw new HttpError(418, "TEAPOT");                      // any status and code
class QuotaExceeded extends defineError(402, "QUOTA_EXCEEDED") {}
```

The handler classifies in this order: your `map(err, ctx)` if configured (return an `HttpError` or `{ status, code, message, details? }`, or `undefined` to fall through), then `HttpError`, then raw schema errors (422), then body-parser errors (400 or 413), then anything with a numeric `status` between 400 and 599 (the `http-errors` convention), then everything else as 500 `INTERNAL`. With `expose: true` (the default outside production) a 500 carries the real message and stack. Every 5xx is logged with the request id and route.

```ts
app.errors({
  map: (err) => (isUniqueViolation(err) ? new Conflict("Already exists") : undefined),
  format: (mapped, ctx) => ({ error: mapped, traceId: ctx.requestId }),  // replaces the envelope
});
```

Side effects (alerting, metrics) go through `onError` hooks, not the handler. The built-in classes and their codes are listed in the [Reference](/reference#error-codes).

## Hooks

Hooks observe; they cannot change the response. Three exist at router and app level.

```ts
router.onRequest((ctx) => metrics.inc("orders.requests"));     // after match, before middleware
router.onResponse((ctx, result) => { /* after send */ });
router.onError((ctx, err) => reporter.capture(err));            // once per error
app.onRequest((ctx) => { /* first thing, every request, matched or not */ });
```

Router hooks run before app hooks, outer routers before inner, and every error is observed exactly once at each level: the router marks it, and the error handler runs app hooks only for errors that never passed through a router (a plain Express route, the 404). A throwing `onRequest` fails the request; throwing `onResponse` and `onError` hooks are logged and ignored.

## Config

`defineConfig` resolves once at boot, validates every leaf, reports every problem together, and returns a frozen typed object.

```ts
export const config = defineConfig({
  port: env.port({ default: 3000 }),
  database: { url: env.url(), poolSize: env.integer({ default: 5 }) },
  auth: { secret: env.string(), sessionTtl: env.duration({ default: "30d" }) },
  features: z.object({ beta: z.boolean() }).default({ beta: false }),   // any schema is a leaf
});
config.auth.sessionTtl;   // number, milliseconds
```

Each leaf maps to one variable by path: `database.url` reads `DATABASE_URL`. Sources, highest first: `overrides` (for tests), `process.env`, `.env.<env>.local`, `.env.local`, `.env.<env>`, `.env`, then the default. Files are read only outside production. Leaves: `env.string`, `number`, `integer`, `port`, `boolean`, `duration`, `bytes`, `url`, `enum`, `list`, each taking `{ default, optional }`. Failure is one `ConfigError` naming every bad path and variable. `config.$print()` redacts anything matching `/secret|password|token|key/i` for a startup log line. Modules ship their options as fragments you can drop into `defineConfig` (`upload: uploadConfig`) and pass straight to the factory (`uploads(config.upload)`).

## Logging and ambient context

notio logs through pino behind a small `Logger` interface. The exported `log` is a proxy that resolves at call time: inside a request it is `ctx.log`, inside `runWithCtx` it is that context's logger, elsewhere the root. One import works in handlers, services and scripts, and a line written deep inside a service still carries the request id.

```ts
import { log, currentCtx, requireCtx, runWithCtx } from "@jetframez/notio";

log.info({ orderId }, "order placed");
currentCtx()?.requestId;                  // Ctx | undefined, anywhere, via AsyncLocalStorage
requireCtx();                             // throws Internal outside a request
await runWithCtx({ kind: "job" }, async (ctx) => { log.info("starting"); });   // jobs and CLI
```

`createApp({ logger })` takes `level` (default `LOG_LEVEL`, then `info`), `pretty` (on outside production on a TTY), `redact` (defaults cover `authorization`, `cookie`, `set-cookie`, `password`, `token`), `base`, `name`, and `destination` (a writable, for tests). The framework writes one `info` line per request with method, path, route, status and duration, one `error` line per 5xx, and listen and shutdown lines. `/health` and `/ready` are not logged.

## Events

A typed in-process bus. Listeners run under the emitter's request context, so `log` and `currentCtx()` inside a listener still refer to the request that emitted.

```ts
type Events = { "order.placed": { orderId: string }; "stock.low": { sku: string } };
export const events = createEvents<Events>();

events.on("order.placed", async (payload, meta) => mailer.confirm(payload.orderId));
events.on("order.*", (payload) => { /* union of order.* payloads */ });
const off = events.once("stock.low", restock);

await events.emit("order.placed", { orderId });          // schedules listeners, resolves immediately
await events.emitAndWait("order.placed", { orderId });   // waits; rejects with the listener's error
events.onError(({ name, error }) => reporter.capture(error));
```

Pass schemas instead of types and payloads are validated on emit outside production. Listener errors under `emit` are isolated and logged. There is no persistence: an event is lost if the process dies before its listeners run.

## Cache

Keyv underneath: memory by default, Redis through the optional `@keyv/redis` package.

```ts
const cache = createCache({ prefix: "shop", ttl: "5m", app });   // app registers close() on shutdown
// or: createCache({ store: await redisStore(config.redis.url), prefix: "shop" })

await cache.set("product:1", product, { ttl: "1h" });
await cache.get<Product>("product:1");
await cache.remember("products:featured", "10m", () => db.featured());   // concurrent misses share one call
await cache.tags("products", `user:${id}`).set("cart:42", cart);
await cache.tags("products").flush();                                    // every entry set through that tag
```

## Auth

`@jetframez/notio/auth` is deliberately small: strategies, sessions, JWTs, opaque tokens with rotation, password hashing. No OAuth, magic links, 2FA, email verification, password reset or permissions model; build those on top with `currentUser()`.

```ts
import { createAuth, cookieSession, jwt, opaque, apiKey, currentUser } from "@jetframez/notio/auth";

const auth = createAuth<User>({          // User must have id: string
  adapter,                               // your database; see the adapter interface in the Reference
  strategies: {
    session: cookieSession({ ttl: "30d", rolling: true }),
    bearer: jwt({ secret: config.auth.secret, ttl: "15m" }),
    refresh: opaque({ ttl: "30d" }),
    apiKey: apiKey({ header: "x-api-key", verify: (key) => db.apiKeys.findUser(key) }),
  },
  default: "session",
});

router.get("/me").use(auth.require()).handle((ctx) => ctx.user);              // User; 401 otherwise
router.get("/feed").use(auth.optional()).handle((ctx) => ctx.user?.id);       // User | undefined
router.get("/x").use(auth.require("bearer", "apiKey")).handle(...);           // first match wins

await auth.hashPassword(pw);                       // store the result
const user = await auth.verifyPassword(email, pw); // constant-time; throws Unauthorized
await auth.login(ctx, user);   await auth.logout(ctx);   await auth.logoutEverywhere(user.id);

const { accessToken, refreshToken } = await auth.issueTokens(user);   // needs jwt() + opaque()
await auth.refresh(refreshToken);   // rotates; 30s replay grace; reuse outside it revokes the family
router.use(auth.csrf());            // double-submit cookie for cookie sessions
```

`createAuth()` checks at call time that the adapter implements every method the configured strategies need and lists every missing one together. `jwt` is stateless; `require("bearer", { verifySession: true })` re-checks the refresh family for tokens from `issueTokens`. Password hashing is `scrypt()` by default, `argon2()` behind the optional `@node-rs/argon2` package.

## Uploads

`@jetframez/notio/upload` handles `multipart/form-data`: files stream to a temp directory (or stay in memory under a threshold), the type is detected from content rather than trusted from the client, and text fields validate through the ordinary `.body()` schema.

```ts
import { uploads } from "@jetframez/notio/upload";

app.use(uploads({ maxFileSize: "10mb", maxTotalSize: "50mb" }));

router
  .post("/products/:id/images")
  .body(z.object({ caption: z.string() }))
  .uploads({
    cover: { types: ["image/jpeg", "image/png"] },
    gallery: { types: ["image/*"], maxCount: 6, optional: true },
  })
  .handle(async (ctx) => {
    ctx.uploads.cover;                                  // UploadedFile
    ctx.uploads.gallery;                                // UploadedFile[] | undefined
    return { path: await ctx.uploads.cover.move(`./storage/${ctx.params.id}/cover.jpg`) };
  });
```

Field options `maxSize`, `types`, `messages` override the global ones. Failures are a 422 with `details.in: "uploads"` and one issue per field (`FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `TOO_MANY_FILES`, `FILE_REQUIRED`, `UNEXPECTED_FILE`, `TOTAL_SIZE_EXCEEDED`). An `UploadedFile` has `filename` (sanitised), `mimeType` (detected), `size`, `path` or `buffer`, `stream()`, `move(to)`, `keep()`, `discard()`. Temp copies are deleted when the response finishes unless moved or kept. Where the bytes end up (S3, a blob column, disk) is yours.

## Rate limiting

`@jetframez/notio/rate-limit` limits by key. In memory for one process; hand it your Redis client and every decision becomes one atomic Lua script.

::: code-group

```ts [memory]
import { rateLimit } from "@jetframez/notio/rate-limit";

router.use(rateLimit({ limit: 100, window: "1m" }));
router.post("/login").use(rateLimit({ limit: 5, window: "15m", key: (ctx) => ctx.body?.email ?? ctx.ip }));
```

```ts [Redis]
const redis = new Redis(config.redis.url);

app.use(rateLimit({ limit: 1000, window: "1m", store: redis, name: "global" }));
router.post("/login").use(rateLimit({ limit: 5, window: "15m", store: redis, name: "login" }));
```

:::

Every response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`; exceeding throws `TooManyRequests` (429) with `Retry-After`. `algorithm` is `"fixed"` (cheapest), `"sliding"` (a hard "N in any window" guarantee), or `"token-bucket"` (bursts allowed up to `limit`, best for browsers). `key` returning `null` skips; `skip` bypasses; `cost` charges more than one point; `name` separates limiters on a shared client; `fallback` (default on) keeps serving from a per-process copy if Redis errors. Both backends are race-free under concurrent requests.

## OpenAPI

`@jetframez/notio/openapi` walks `routes()` into an OpenAPI 3.1 document and serves it with a Scalar UI. No code generation.

```ts
import { openapi } from "@jetframez/notio/openapi";

const spec = openapi({
  info: { title: "Shop API", version: "1.0.0" },
  security: { session: { type: "apiKey", in: "cookie", name: "sid" }, bearer: { type: "http", scheme: "bearer" } },
}).from(app);                       // an App, one or more Routers, or a mix

app.use(spec.docs("/docs"));        // UI at /docs, JSON at /docs/openapi.json
spec.document;                      // plain object, for a CI export
```

Every route not marked `.hidden()` becomes an operation: parameters from `.params()`/`.query()`/`.headers()`, `.body()` as JSON or `.uploads()` as multipart, responses from `.response()` and `.errors()`, a 422 added for any route with an input schema, 401 and 403 for routes behind `auth.require()`, and `security` entries for strategy names you gave a scheme. Schemas convert through Zod's `z.toJSONSchema()`, Valibot's `@valibot/to-json-schema`, or ArkType's `.toJsonSchema()`; a schema with a title is hoisted to `components.schemas`, an untitled one is inlined. Register `schemaConverters` for anything else, and `wrapResponse` to document an envelope.

## Testing and production

Test through HTTP, the way the framework tests itself: `createApp({ shutdown: { signals: false } })`, `listen(0)`, plain `fetch`, then `close()`. Pass a `logger` with a `destination` to capture log lines and `defineConfig({ overrides })` to pin config values.

`NODE_ENV=production` stops reading `.env` files, stops validating `.response()` schemas, hides 500 messages and stacks, and switches logs to JSON lines. Set `app.express.set("trust proxy", 1)` behind a load balancer, point readiness probes at `/ready`, and pass a Redis client to the rate limiter and cache once you run more than one process.
