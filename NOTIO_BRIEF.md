# notio — Build Brief

`@jetframez/notio` is a TypeScript web framework whose transport layer is Express 5. It adds a typed, chainable router, a per-request context, unified errors, lifecycle hooks, structured logging, config, and a set of optional modules (auth, uploads, rate limiting, cache, events, OpenAPI). Every piece is usable on a bare Express app; `createApp()` wires them correctly.

This document is the source of truth for scope and API shape. Where it is silent, prefer the simplest design that keeps Express visible and avoids new concepts.

---

## 1. Principles

1. **Express is the transport.** `app.express` is always the real Express instance. Any `(req, res, next)` middleware from the ecosystem works unchanged. We never wrap `cors`, `helmet`, `compression`, or similar.
2. **Wrap only when it adds behaviour.** A module exists only if it needs `ctx`, produces errors that should join the unified shape, needs types the ecosystem can't give, or participates in ALS/hooks. Otherwise it stays userland.
3. **Own the interface, borrow the engine.** Uploads on busboy, logging on pino, rate limiting on rate-limiter-flexible, cache stores on Keyv, JWT on jose. We write the API; we don't rewrite solved problems.
4. **No decorators, no DI container, no middleware phases, no globals** except `AsyncLocalStorage` for the request context.
5. **Handlers return values.** The router owns the send step. Errors are thrown, never passed to `next(err)`.
6. **Nothing implicit at boot.** Modules are constructed by the user and passed where needed; there is no plugin registry or auto-discovery.
7. **Fail at startup, not at first use.** Config, missing adapter functions, and misconfigured strategies error at boot with every problem listed.

---

## 2. Repository layout

pnpm workspace + Turborepo. Internal packages have real boundaries; one package is published.

```
notio/
  packages/
    core/         @notio-internal/core        router, ctx, errors, hooks, ALS, logger, config, cookies, static, events, cache
    auth/         @notio-internal/auth        depends on core
    upload/       @notio-internal/upload
    rate-limit/   @notio-internal/rate-limit
    openapi/      @notio-internal/openapi
    notio/        @jetframez/notio            published façade; re-exports the above via subpaths
  examples/       runnable apps, type-checked in CI, embedded in docs
  docs/           VitePress
```

Published package `exports`:

```
"."             → core
"./auth"        → auth
"./upload"      → upload
"./rate-limit"  → rate-limit
"./openapi"     → openapi
```

Build with tsdown; internal packages are `noExternal` (inlined) so the published package depends only on third-party libraries. Internal packages may only import what their own `package.json` declares; enforce this.

Tooling: TypeScript strict, ESM/NodeNext, Biome, Vitest, changesets. Node ≥ 22.

Heavy/optional dependencies: password hashing defaults to Node `crypto.scrypt`; `@node-rs/argon2` is an optional upgrade, lazily imported with a clear install message. Redis stores (`@keyv/redis`) are `optionalDependencies`, lazily imported.

---

## 3. Core: `createApp`

```ts
import { createApp } from "@jetframez/notio";

const app = createApp({
  logger: { level, pretty, redact, startup },
  cookies: { secret },                 // only needed for signed cookies
  body: { json: { limit: "1mb" }, urlencoded: false },   // defaults shown; false disables
  health: { path: "/health", ready: "/ready" },          // false disables
});

app.use(...middleware);                // Express (req,res,next) or notio (ctx,next); any mix
app.mount(router);                     // uses the router's own prefix
app.mount("/api/v1", routerA, routerB);
app.static(path, dir, options);
app.redirect(from, to, status?);

app.errors({ map, format, expose });   // configures the built-in error handler; never registered by the user

app.onRequest(fn); app.onResponse(fn); app.onError(fn);   // observation only
app.onStart(fn);   app.onReady(fn);    app.onShutdown(fn);

app.routes();                          // aggregated route metadata for OpenAPI
app.express;                           // raw Express instance (escape hatch; bypasses ordering)

await app.listen(port, cb?);           // resolves when bound; also accepts Express-style callback
await app.close();
```

**Ordering is enforced at `listen()`**, regardless of call order: ctx/ALS middleware → body parsers → user `use`/`mount`/`static`/`redirect` in registration order → 404 → error handler.

**Lifecycle**: `onStart` hooks (async, awaited) → bind → `onReady` hooks + listen callback. On SIGTERM/SIGINT: stop accepting, drain in-flight requests within a deadline (default 10s), run `onShutdown` hooks, exit. Modules with resources (stores, connections) register `onShutdown` themselves when given the app, or expose `close()`.

**Health**: `/health` returns 200 always once listening; `/ready` returns 200 after `onReady` and 503 during shutdown. Both are excluded from request logging by default.

---

## 4. Core: Router

Chainable. The router is itself an Express handler (`app.use(router)` works on a bare Express app).

```ts
const router = new Router("/orders");          // prefix optional
router.use(...middleware);                      // router-level

router.get("/:id")
  .params(schema)?                              // optional; default type is strings from the path
  .query(schema)?
  .headers(schema)?
  .body(schema)?                                // not available on get/delete
  .uploads({...})?                              // requires the upload module
  .use(...middleware)?                          // route-level
  .summary(text)? .tags(...)? .response(schema)? .response(status, schema)? .errors(...ErrorClasses)? .deprecated()? .hidden()?
  .handle(async (ctx) => value);

router.group("/admin", (r) => { r.use(...); r.get(...)... });   // child router, inherits prefix + middleware
router.group("/admin", [mw], (r) => {...});
router.mount("/sub", otherRouter);              // same mechanism as group, for routers defined elsewhere
router.static(path, dir, { maxAge: "1d", immutable, spa });    // delegates to express.static; inherits prefix + middleware
router.redirect(from, to, status = 302);

router.onRequest(fn); router.onResponse(fn); router.onError(fn);
router.routes();                                // RouteInfo[] (metadata); excludes statics
router.statics();
```

**Type inference** (the most important part; design and test first):
- `params` from the path string: `"/orders/:id/lines/:lineId"` → `{ id: string; lineId: string }`. A `.params(schema)` must have exactly those keys (compile error otherwise) and may transform types.
- `query`/`body`/`headers` from schemas via **Standard Schema** (`~standard.validate`), so Zod, Valibot, ArkType all work. No hard dependency on Zod.
- Middleware typed as `Middleware<Adds>` narrows `ctx` for everything after it in the chain (router → group → route).

**Validation** runs after router/group middleware, before route-level middleware and the handler. Query values arrive as strings; schemas coerce. Single query values are normalised to arrays when the schema expects an array. Unknown keys are stripped (schema `.strict()` to reject). Without a schema: `params` typed from path, `query` is `Record<string, string | string[]>`, `body` is `unknown`. Failures throw `Unprocessable` (422) with `details: { in: "params" | "query" | "headers" | "body" | "uploads", issues: [{ path, code, message, meta? }] }`. First failing section only.

**`.response(schema)`** validates the return value only when `NODE_ENV !== "production"`, throwing `Internal` on mismatch. Router option to disable. Otherwise metadata only.

---

## 5. Core: Ctx

One per request, created by the first middleware `createApp` installs (or by the router if used on bare Express), stored on `res.locals.ctx`, and made ambient via ALS.

```ts
interface Ctx<P = Record<string, string>, B = unknown, Q = Record<string, string | string[]>, H = ...> {
  req: express.Request; res: express.Response;          // always the real objects
  params: P; query: Q; body: B; headers: Headers<H>;
  uploads: ...;                                          // present when the route declared .uploads()
  requestId: string;                                     // X-Request-Id if present, else generated
  method: string; path: string; route?: string;          // route = matched pattern, e.g. "POST /orders/:id"
  url: URL; ip: string;                                  // ip respects Express trust proxy
  bearer(): string | undefined;
  accepts(...types): string | false;

  headers: { get(name): string | undefined; has(name): boolean; all(): Record<string, string | string[]>;
             set(name, value): Ctx; append(name, value): Ctx };
  set(name, value): Ctx;                                 // shortcut for headers.set
  status(code): Ctx;                                     // mutators for a plain return

  cookies: { get(name); set(name, value, options); delete(name); all();
             getSigned(name); setSigned(name, value, options) };

  // response descriptors (return them)
  json(data, { status?, headers? }); text(body, {...}); redirect(url, status?);
  file(path, { type? }); download(path, filename?); stream(readable, { type?, headers?, status? });
  empty(status?); raw((res) => void);

  state: Record<string, unknown>;
  log: Logger;                                           // child of root with requestId, route, + bound fields
  bind(fields): void;                                    // ctx.log = ctx.log.child(fields)
}
```

Augmentation: `declare module "@jetframez/notio" { interface Ctx { user?: User } }` globally, or `Middleware<{ user: User }>` per middleware for chain narrowing.

Cookies: parsed lazily with the `cookie` package; writes via `res.append("Set-Cookie")`. Defaults `path: "/"`, `httpOnly: true`, `sameSite: "lax"`, `secure` when HTTPS/trust proxy. `maxAge` accepts duration strings. Signed cookies use HMAC-SHA256 with key rotation (`secret: string | string[]`). `getSigned`/`setSigned` throw a clear error if no secret is configured.

`BaseCtx` is the subset without HTTP fields (`requestId`, `kind`, `log`, `state`, augmentations) used by `runWithCtx` for jobs/CLI.

---

## 6. Core: Middleware

Two forms accepted everywhere (`app.use`, `router.use`, `group`, route `.use`), distinguished by arity:

```ts
type ExpressMiddleware = (req, res, next) => void;                     // runs untouched
type CtxMiddleware<Adds = {}> = (ctx: Ctx, next: () => Promise<void>) => Promise<void> | void;
```

Rules:
- Errors are **thrown**. The wrapper forwards to Express's error path.
- `await next()` continues. Not calling it must mean the middleware responded (via `ctx.res`/descriptor) or threw; otherwise the wrapper throws `Internal("middleware ended without responding or calling next")`.
- Code after `await next()` runs after downstream completed (onion available, not required).
- One ordering rule: registration order, outer to inner. No phases, no priorities.
- Optional helper: `guard(predicate, () => Error)` for one-line checks.

---

## 7. Core: Responses

| Handler returns | Response |
|---|---|
| `string` | `text/plain`, 200 |
| object / array / number / boolean / `null` | JSON, 200 (201 for POST) |
| `undefined` | 204, empty |
| `Readable` / `Buffer` | streamed / bytes, `application/octet-stream` unless set |
| descriptor from `ctx.json/text/redirect/file/download/stream/empty/raw` | as described |
| handler wrote to `ctx.res` (`headersSent`) | router does nothing; `warn` if a value was also returned |

`ctx.status()`/`ctx.set()` apply to plain returns. Descriptor wins over mutators. No per-router defaults, no serialize hook.

---

## 8. Core: Errors

```ts
class HttpError extends Error { constructor(status: number, code: string, message?: string, details?: unknown) }
BadRequest 400, Unauthorized 401, Forbidden 403, NotFound 404, MethodNotAllowed 405, Conflict 409, Gone 410,
PayloadTooLarge 413, Unprocessable 422 (code VALIDATION), TooManyRequests 429 (code RATE_LIMITED), Internal 500, ServiceUnavailable 503
defineError(status, code) → subclass factory
```

Wire shape, always: `{ code, message, details?, requestId }`.

Built-in error handler (configured via `app.errors({ map, format, expose })`, or `errorHandler(opts)` for bare Express):
1. `map(err, ctx)` if provided; a returned value is used, `undefined` falls through.
2. `HttpError` → its status/code/message/details.
3. Standard Schema / Zod issues → 422 `VALIDATION`.
4. body-parser errors → 400 malformed JSON, 413 over limit.
5. Any error with numeric `status`/`statusCode` (http-errors convention) → that status; message exposed only if `err.expose`.
6. Everything else → 500 `INTERNAL`, logged with full error. `expose: true` includes message and stack in the body; `false` hides them. Error name is never included.

`format(mapped, ctx)` changes the envelope. The handler has no side-effect option; side effects go through hooks.

---

## 9. Core: Hooks

`onRequest(ctx)`, `onResponse(ctx, result?)`, `onError(ctx, err)` on routers and on the app (`hooks(app, {...})` for bare Express). Observation only; cannot alter the response. Router-level hooks run before app-level. `onError` fires exactly once per error: the router runs hooks then forwards; the error handler runs app hooks only for errors that reached it unflagged (non-router errors). `onResponse` at app level uses `res.on("finish"/"close")`; router-level fires with the return value in hand.

---

## 10. Core: ALS, logger, config

**ALS**: `currentCtx(): Ctx | undefined`, `requireCtx(): Ctx` (throws), `runWithCtx(partial: Partial<BaseCtx>, fn)` for jobs/CLI (`kind: "job"`, etc.). The app wraps each request in `als.run(ctx, next)`.

**Logger**: pino underneath, behind a `Logger` interface (`trace/debug/info/warn/error/fatal`, `child(fields)`, `isLevelEnabled`). Root logger created by `createApp({ logger })` or lazily with defaults; `configureLogger()` for scripts. `ctx.log` is a child with `requestId`, `route`, and bound fields. Exported `log` is a proxy: `(currentCtx()?.log ?? root)[level](...)`, so the same import works inside and outside requests. Level from config (`LOG_LEVEL`), pretty in dev via pino transport, JSON in prod. Redaction defaults: `authorization`, `cookie`, `set-cookie`, `password`, `*.password`, `*.token`. Framework logs: one `info` per request in `onResponse` (method, route pattern, status, duration, requestId, bound fields), one `error` per 5xx, listen/shutdown lines (`startup: false` disables).

**Config**: `defineConfig(shape)` where leaves are Standard Schema values and nesting is plain objects. Env mapping by convention: `database.url` → `DATABASE_URL`. Sources: process env > `.env.${env}.local` > `.env.local` > `.env.${env}` > `.env` (dotenv files only when not production) > schema defaults. All errors reported together at boot. `overrides` option for tests. Returns a frozen typed object; `$print()` redacts keys matching `/secret|password|token|key/i`. Modules export config schema fragments and their factories accept **partial plain objects**, applying the schema themselves, so `defineConfig` is optional: `uploads()`, `uploads({ maxFileSize: "50mb" })`, `uploads(config.upload)`, `uploads({ ...config.upload, messages })` all valid.

**Duration strings** (`"5m"`, `"30d"`, `"1h"`) accepted wherever a time is configured; numbers are milliseconds.

---

## 11. Core: Events

```ts
export type Events = { "order.placed": { orderId: string } };   // optional
export const events = createEvents<Events>();                    // untyped without the generic
events.emit(name, payload)          // async, fire-and-forget; resolves when listeners are scheduled
events.emitAndWait(name, payload)   // runs all listeners; rejects if any threw
events.on(name, fn); events.once(name, fn); events.off(name, fn); events.on("stock.*", fn)
events.onError(fn)                  // listener errors are isolated and reported here (and logged)
```

Map values may be schemas instead of types for dev-time payload validation. Listeners run under the emitter's context (`runWithCtx` capturing `currentCtx()`); `meta` argument carries `name`, `id`, `emittedAt`. No outbox or queue adapters in this phase.

---

## 12. Core: Cache

```ts
const cache = createCache({ store?: KeyvStoreAdapter, prefix?: string });   // memory by default
cache.get(key); cache.set(key, value, { ttl }); cache.delete(key); cache.has(key); cache.clear();
cache.remember(key, ttl, fn);        // stampede-guarded: concurrent misses share one in-flight promise
cache.tags(...tags)                  // scoped cache; .set/.remember associate entries; .flush() removes them
```

Keyv underneath; memory adapter shipped; Redis via `@keyv/redis` (optional). Tags implemented as a key-set per tag in the store.

---

## 13. Module: upload (`@jetframez/notio/upload`)

```ts
app.use(uploads({ tempDir, maxFileSize: "10mb", maxTotalSize: "50mb", memoryThreshold: "0", sweepAfter: "1h", types?, messages? }));

router.post("/x").uploads({
  image:   { maxSize: "5mb", types: ["image/jpeg", "image/png"], messages? },
  gallery: { maxSize: "5mb", types: ["image/*"], maxCount: 6, optional: true },
}).handle((ctx) => ctx.uploads.image /* UploadedFile */, ctx.uploads.gallery /* UploadedFile[] | undefined */);
```

- busboy underneath; each file streams to `tempDir/<requestId>/<random>`; size limits cut the stream mid-write.
- Type detection by magic bytes (`file-type`), not the client header. `types` accepts exact or `image/*`.
- Undeclared fields → 422 `UNEXPECTED_FILE`. Required fields missing → `FILE_REQUIRED`.
- Precedence for limits and messages: field > global > built-in default.
- Cleanup deletes the request's temp dir on `finish`, `close`, and error paths, unless `move(to)` or `keep()` was called. Startup sweep removes dirs older than `sweepAfter`.
- `UploadedFile`: `field, filename (sanitised), mimeType, size, path?, buffer?, stream(), move(to), keep(), discard()`.
- Issue codes (exported const, typed `messages` keys): `FILE_TOO_LARGE, FILE_TYPE_NOT_ALLOWED, TOO_MANY_FILES, FILE_REQUIRED, UNEXPECTED_FILE, TOTAL_SIZE_EXCEEDED`. Messages may be strings or `(meta) => string`.
- `.uploads()` without the module installed throws at startup with an install message. Text fields of a multipart form validate through `.body()`.

---

## 14. Module: auth (`@jetframez/notio/auth`) — minimal by design

```ts
const auth = createAuth<User>({
  adapter,                      // see below; missing functions reported at boot per configured strategy
  strategies: {
    session: cookieSession({ cookie: "sid", ttl: "30d", rolling: true, absolute?, secure?, sameSite?, domain? }),
    bearer:  jwt({ secret | keys, ttl: "15m", issuer?, audience?, algorithm? }),
    token:   opaque({ ttl: "30d", rolling: true, header?: "authorization" }),
    apiKey:  apiKey({ header | query, verify }),
    device:  custom((ctx) => Principal | null, { login?, logout? }),
  },
  default: "session",
  hash?: scrypt() | argon2(),   // scrypt default (no native dep)
});

auth.require(...strategies)                 // Middleware<{ user: User }>; 401 if none succeed; marks OpenAPI security
auth.optional({ rejectInvalid? })           // Middleware<{ user?: User }>; absent → undefined; invalid → undefined unless rejectInvalid
auth.hashPassword(pw); auth.verifyPassword(email, pw)   // constant-time; throws Unauthorized
auth.login(ctx, user); auth.logout(ctx); auth.logoutEverywhere(userId)
auth.issueToken(user, { ttl })              // single JWT, no refresh
auth.issueTokens(user)                      // { accessToken, refreshToken, expiresIn }
auth.refresh(refreshToken)                  // rotation + family + grace window + reuse detection
auth.csrf()                                 // middleware for cookie sessions
currentUser(); requireUser()                // via ALS
```

Adapter interface:

```ts
interface AuthAdapter<User> {
  findUserById(id): Promise<User | null>;
  findUserByEmail(email): Promise<(User & { passwordHash: string }) | null>;
  createSession({ tokenHash, userId, familyId, expiresAt, meta? }): Promise<void>;
  findSession(tokenHash): Promise<{ userId, familyId, expiresAt, rotatedAt: Date | null } | null>;
  updateSession(tokenHash, { expiresAt?, rotatedAt? }): Promise<void>;
  deleteSession(tokenHash): Promise<void>;
  deleteSessionsByFamily(familyId): Promise<void>;
  deleteSessionsByUser(userId): Promise<void>;
}
```

Refresh tokens: opaque random, stored hashed (sha256) through the session adapter with a `familyId` per login. `refresh()` marks the old record `rotatedAt`, creates a new one in the same family, returns a new pair. Presenting a rotated token within the grace window (default 30s) returns the same new pair; beyond it, the whole family is deleted (reuse detection). Rotated records are cleaned by expiry/`sweep`. Sessions use `rolling` expiry throttled to one write per minute. Optional per-route `require("bearer", { verifySession: true })` re-checks the session record.

Out of scope: OAuth, magic links, 2FA, email verification, password reset, authorization/permissions. A Better Auth bridge (`betterAuth(instance)` → strategy + `handler(path)`) is planned but not in this phase.

---

## 15. Module: rate-limit (`@jetframez/notio/rate-limit`)

```ts
rateLimit({ limit, window: "1m", key?: (ctx) => string | null, skip?, cost?, algorithm?: "sliding" | "fixed" | "token-bucket", store?, name? })
```

- Default key `ctx.ip`; `null` skips. Exceeding throws `TooManyRequests` with `details: { limit, window, retryAfter }`.
- Headers on every response: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; `Retry-After` on 429.
- `rate-limiter-flexible` underneath; memory default, Redis via Keyv-compatible store option.
- `onLimited(ctx)` hook.

---

## 16. Module: openapi (`@jetframez/notio/openapi`)

```ts
const spec = openapi({ info, servers?, security?: { bearer: {...}, ... }, wrapResponse? }).from(app | ...routers);
app.use(spec.docs("/docs"));     // Scalar UI; serves /docs/openapi.json
// CLI: notio openapi export
```

- Walks `routes()` through mounts/groups; params from path; schemas → JSON Schema via Standard Schema (Zod 4 native, others via their converters); named schemas hoisted to `components`.
- `.errors(NotFound, ...)` → documented responses using the unified error body. 422 added automatically for routes with input schemas; 401/403 when a security requirement applies.
- Security requirements inherited from `auth.require()` in the chain; unmarked middleware is invisible.
- `.uploads()` → `multipart/form-data` with `format: binary` and constraints in descriptions.
- No code generation.

---

## 17. Parked (do not build in this phase)

jobs (chainable define/dispatch, chains, batches, pg-boss/BullMQ/memory), scheduler, TS client inferred from router types, testing helpers (`testClient`, `testCtx`), Better Auth bridge, events outbox/queue adapters.

---

## 18. Milestones

Each milestone: implement, type-check, lint, test, write the guide page, stop for review.

- **M0 — Router types.** Path param inference, chain accumulation, `Middleware<Adds>` narrowing, Standard Schema inference. Type tests (vitest `expectTypeOf`) before runtime code.
- **M1 — Router runtime.** Compile to `express.Router()`, validation, response conventions, descriptors, `group`/`mount`/`static`/`redirect`, `routes()`.
- **M2 — Ctx + errors.** Ctx construction, cookies, headers, `HttpError` family, `errorHandler`, classification.
- **M3 — Hooks + ALS + logger.** `hooks()`, router hooks, `currentCtx/requireCtx/runWithCtx`, pino logger, `log` proxy, request/error lines, redaction.
- **M4 — Config.** `defineConfig`, env mapping, dotenv precedence, overrides, module fragment pattern, duration strings.
- **M5 — `createApp`.** Ordering, body parsers, health/ready, lifecycle, graceful shutdown, `errors()`, `app.routes()`.
- **M6 — Events + cache.** In core.
- **M7 — upload.**
- **M8 — auth.** scrypt default, strategies, adapter checks, sessions, JWT, opaque, refresh with rotation/family/reuse detection, CSRF.
- **M9 — rate-limit.**
- **M10 — openapi.**
- **M11 — Façade + publish.** `@jetframez/notio` subpath exports, tsdown inlining, changesets, first release. `examples/minimal` and `examples/auth-drizzle` in CI. Docs site skeleton.

---

## 19. Definition of done (per milestone)

- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass; type tests exist for any public generic.
- Public API documented with TSDoc; guide page written from this brief's wording.
- No `req`/`res` leakage into module internals beyond the router/ctx boundary.
- Every error thrown by the framework is an `HttpError` or is classified by the error handler.
- Every configurable value accepts inline partial objects with defaults applied.
- No new dependency without justification in the PR description.

---

## 20. Working style

- Ask before adding a concept not in this brief. Prefer removing to adding.
- When two designs are equally simple, choose the one that reads more like Express.
- Keep milestones small; open a PR per milestone and stop.
- Write the guide page in the same PR as the feature.
