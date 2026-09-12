---
title: Reference
---

# Reference

Tables and signatures. The [Guide](/) explains how the pieces fit; this page is for looking things up.

## `createApp(options)`

| Option | Default | Meaning |
|---|---|---|
| `logger` | `{}` | Logger options (below) plus `startup: false` to silence listen/shutdown lines. An existing `Logger` is accepted. |
| `cookies.secret` | none | Key or keys for signed cookies; the first signs, all verify. |
| `body.json` | `{ limit: "1mb" }` | JSON parsing. `false` disables. |
| `body.urlencoded` | `false` | Form parsing, off by default. |
| `health` | `{ path: "/health", ready: "/ready" }` | Either can be `false`, or the whole option. |
| `shutdown.deadline` | `"10s"` | How long in-flight requests may take before connections are closed. |
| `shutdown.signals` | `true` | Handle `SIGTERM`/`SIGINT` by draining and exiting. |

App methods: `use(...middleware)`, `mount(router)` / `mount(prefix, ...routers)`, `static(path, dir, options?)`, `redirect(from, to, status?)`, `errors({ map?, format?, expose? })`, `onStart(fn)`, `onReady(fn)`, `onShutdown(fn)`, `onRequest/onResponse/onError(fn)`, `listen(port, host?, cb?)`, `close()`, `routes()`, `express`.

Bare Express: `context({ logger?, cookieSecret?, requestLog? })`, `hooks(app, { onRequest, onResponse, onError })`, `notFound()`, `errorHandler({ map?, format?, expose?, logger? })`.

## Router

| Method | Notes |
|---|---|
| `new Router(prefix?, { validateResponses? })` | `validateResponses` defaults to `true` |
| `.get` `.post` `.put` `.patch` `.delete` `.head` `.options(path)` | Returns a route builder |
| `.use(...middleware)` | Applies to everything registered after it; keep the return value for narrowing |
| `.group(prefix, middleware?, fn)` | Sub-router sharing prefix and middleware |
| `.mount(path, router)` | Copies middleware at mount time |
| `.static(path, dir, { maxAge?, immutable?, spa?, ...expressStatic })` | |
| `.redirect(from, to, status = 302)` | |
| `.onRequest` `.onResponse` `.onError(fn)` | Router-level hooks |
| `.routes()` `.statics()` `.redirects()` | Metadata, including groups and mounts |
| `.express()` | The compiled `express.Router` |

### Route builder

| Method | Notes |
|---|---|
| `.params(schema)` | Must declare exactly the path's parameters |
| `.query(schema)` `.headers(schema)` | Values arrive as strings; header names are lower-case |
| `.body(schema)` | Not on `GET`, `DELETE`, `HEAD`, `OPTIONS` |
| `.uploads(spec)` | Needs the upload module installed |
| `.use(...middleware)` | Route-level; after validation, before the handler |
| `.response(schema)` | Constrains the return type; validated outside production |
| `.response(status, schema)` | Documentation only |
| `.summary(text)` `.tags(...tags)` `.errors(...classes)` `.deprecated()` `.hidden()` | Documentation only |
| `.handle(handler)` | Registers the route; returns `RouteInfo` |

Path syntax: `:name`, `*name`, `{/:name}` optional group, `:name.:ext`.

## Context

| Field | Meaning |
|---|---|
| `req`, `res` | The Express request and response |
| `params`, `query`, `body` | Validated by the route's schemas, or raw |
| `headers` | `get`, `has`, `all`; `set`, `append` for the response |
| `cookies` | `get`, `all`, `set(name, value, options)`, `delete`, `setSigned`, `getSigned` |
| `requestId`, `method`, `path`, `route`, `url`, `ip`, `kind` | |
| `state` | Per-request scratch object |
| `log` | Child logger with `requestId`, `route`, bound fields |
| `bearer()`, `accepts(...types)`, `bind(fields)` | |
| `status(code)`, `set(name, value)` | Chainable, apply to plain returns |
| `json`, `text`, `redirect`, `file`, `download`, `stream`, `empty`, `raw` | Response descriptors |

Ambient: `currentCtx()`, `requireCtx()`, `currentBaseCtx()`, `runWithCtx({ kind, state? }, fn)`.

## Middleware

`Middleware<Adds>` is `(ctx, next) => unknown`. Express handlers are accepted by arity. Helpers: `guard(check, error)`, `toExpress(middleware)`, `isDescriptor(value)`.

## Error codes

| Class | Status | Code |
|---|---|---|
| `BadRequest` | 400 | `BAD_REQUEST` (also malformed request bodies) |
| `Unauthorized` | 401 | `UNAUTHORIZED` (also `auth.require()`, `verifyPassword`, bad refresh tokens) |
| `Forbidden` | 403 | `FORBIDDEN` (also `auth.csrf()`) |
| `NotFound` | 404 | `NOT_FOUND` (also the 404 handler) |
| `MethodNotAllowed` | 405 | `METHOD_NOT_ALLOWED` |
| `Conflict` | 409 | `CONFLICT` |
| `Gone` | 410 | `GONE` |
| `PayloadTooLarge` | 413 | `PAYLOAD_TOO_LARGE` (also bodies over the limit) |
| `Unprocessable` | 422 | `VALIDATION` (also every failing schema and upload) |
| `TooManyRequests` | 429 | `RATE_LIMITED` (also the rate limiter) |
| `Internal` | 500 | `INTERNAL` (also any uncaught non-`HttpError`) |
| `ServiceUnavailable` | 503 | `SERVICE_UNAVAILABLE` |

`HttpError(status, code, message?, details?)` for any other status; `defineError(status, code)` returns a subclass to extend; `isHttpError(err)` narrows. Any thrown value with a numeric `status` in 400–599 renders with a code derived from the status text.

Wire shape: `{ code, message, details?, requestId }`. Validation `details` is `{ in: "params" | "query" | "headers" | "body" | "uploads", issues: [{ path, code, message }] }`. Upload issue codes: `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `TOO_MANY_FILES`, `FILE_REQUIRED`, `UNEXPECTED_FILE`, `TOTAL_SIZE_EXCEEDED`.

Error handler classification order: `map` → `HttpError` → schema error with `issues` → body-parser error → numeric `status` → 500.

## Config

`defineConfig(shape, { overrides?, env? })`. Leaves take `{ default?, optional? }`; a leaf with neither is required.

| Leaf | Accepts | Produces |
|---|---|---|
| `env.string()` | string | string |
| `env.number()` `env.integer()` `env.port()` | `"42"` or `42` | number |
| `env.boolean()` | `true/false`, `1/0`, `yes/no`, `on/off` | boolean |
| `env.duration()` | `"30s"`, `"5m"` or milliseconds | milliseconds |
| `env.bytes()` | `"10mb"` or bytes | bytes |
| `env.url()` | absolute URL | string |
| `env.enum([...])` | one of the values | literal union |
| `env.list()` | `"a, b, c"` or an array | `string[]` |

Variable name is the path in SCREAMING_SNAKE: `upload.maxFileSize` → `UPLOAD_MAX_FILE_SIZE`. Precedence: `overrides`, `process.env`, `.env.<env>.local`, `.env.local`, `.env.<env>`, `.env`, default. `<env>` is `NODE_ENV` or `development`; files are read only outside production. Also: `ConfigError`, `config.$print()`, `resolveConfig(fragment, input, label)`, `InferConfigInput<typeof fragment>`.

## Logger

| Option | Default |
|---|---|
| `level` | `LOG_LEVEL`, then `"info"` |
| `pretty` | on outside production when stdout is a TTY |
| `redact` | `authorization`, `cookie`, `set-cookie`, `password`, `token`, top level and one level down |
| `base`, `name` | none |
| `destination` | stdout |

`log` (ambient proxy), `configureLogger(options)`, `createLogger(options)`, `getRootLogger()`. Methods: `trace` `debug` `info` `warn` `error` `fatal` `child(fields)` `isLevelEnabled(level)`.

## Events

`createEvents<Map>()` or `createEvents(schemas)`. `on(name | pattern, listener)`, `once`, `off(name, listener)`, `emit(name, payload)`, `emitAndWait(name, payload)`, `onError(fn)`. Listener receives `(payload, { name, id, emittedAt })`. Patterns: `*` matches any characters.

## Cache

`createCache({ store?, prefix?, ttl?, app? })`, `redisStore(url)`. Methods: `get<T>(key)`, `set(key, value, { ttl? })`, `has`, `delete`, `clear`, `remember(key, ttl, fn)`, `tags(...tags)` → scope with `set`, `remember`, `flush()`, `close()`.

## Auth

`createAuth<User>({ adapter, strategies, default, hash? })`. `User` needs `id: string`.

```ts
interface AuthAdapter<User> {
  findUserById(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null>;
  createSession(input: { tokenHash; userId; familyId; expiresAt; meta? }): Promise<void>;
  findSession(tokenHash: string): Promise<{ userId; familyId; expiresAt; rotatedAt; createdAt? } | null>;
  updateSession(tokenHash: string, changes: { expiresAt?; rotatedAt? }): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsByFamily(familyId: string): Promise<void>;
  deleteSessionsByUser(userId: string): Promise<void>;
  findSessionsByFamily?(familyId: string): Promise<SessionRecord[]>;   // only for verifySession
}
```

| Strategy | Reads | Adapter needs |
|---|---|---|
| `cookieSession({ cookie?, ttl, rolling?, absolute?, secure?, sameSite?, domain? })` | a cookie | session methods |
| `jwt({ secret \| keys, ttl, issuer?, audience?, algorithm? })` | `Authorization: Bearer` | `findUserById` |
| `opaque({ ttl, rolling?, absolute?, header? })` | a bearer header | session methods |
| `apiKey({ header \| query, verify })` | header or query | none |
| `custom(resolve, { login?, logout? })` | anything | none |

Auth object: `require(...strategies, { verifySession? })`, `optional({ rejectInvalid? })`, `hashPassword`, `verifyPassword(email, pw)`, `login(ctx, user)`, `logout(ctx)`, `logoutEverywhere(userId)`, `issueToken(user)`, `issueTokens(user)`, `refresh(token)`, `csrf({ header?, cookie?, methods? })`. Also `currentUser<User>()`, `requireUser<User>()`, `scrypt()`, `argon2()`.

## Uploads

`uploads(options)` global options: `tempDir`, `maxFileSize` (`"10mb"`), `maxTotalSize` (`"50mb"`), `memoryThreshold` (`"0"`), `sweepAfter` (`"1h"`), `types`, `messages`. Field spec: `{ maxSize?, types?, maxCount?, optional?, messages? }`. `messages` maps an issue code to a string or `(meta) => string` with `{ code, field, filename, limit?, actual?, allowed?, detected? }`.

`UploadedFile`: `field`, `filename`, `mimeType`, `size`, `path?`, `buffer?`, `stream()`, `move(to)`, `keep()`, `discard()`.

## Rate limiting

`rateLimit(options)`:

| Option | Default |
|---|---|
| `limit` | required |
| `window` | `"1m"` |
| `key` | `(ctx) => ctx.ip`; `null` skips |
| `skip`, `cost`, `onLimited` | none, `1`, none |
| `algorithm` | `"fixed"`; or `"sliding"`, `"token-bucket"` |
| `store` | memory; or an ioredis-style client |
| `name` | `"notio-rate-limit"` |
| `fallback` | `true` |

Headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After` on 429. Error `details`: `{ limit, window, retryAfter }`.

## OpenAPI

`openapi({ info, servers?, security?, schemaConverters?, wrapResponse? }).from(...sources)` → `{ document, docs(path) }`. Naming a schema for hoisting: Zod `.meta({ id, title })`, Valibot `v.title()`, ArkType `.configure({ title })`. Optional path segments are documented as always present.

## Durations and sizes

Durations: a number is milliseconds; strings take `ms`, `s`, `m`, `h`, `d`, `w`, decimals allowed (`"1.5h"`). Sizes: a number is bytes; strings take `b`, `kb`, `mb`, `gb`, `tb`, binary units. Exported as `parseDuration(value)` and `parseBytes(value)`; invalid input throws `TypeError`.
