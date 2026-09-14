---
title: Exports
---

Every named export from `notio` and its subpaths that the guide documents, grouped by area. Each subpath re-exports more low-level types than are listed here (compiled Lua scripts for the rate limiter, JSON Schema conversion internals, and similar) — those are implementation detail for advanced use, not part of the documented contract, and are best read from source if you need them.

## `notio` — app and lifecycle

| Export | What it is |
|---|---|
| `createApp`, `AppOptions`, `App` | Build a wired Express app — [createApp](../../guide/core/app/) |
| `HealthOptions`, `ShutdownOptions`, `BodyOptions`, `LifecycleHook` | `createApp` option and hook types |
| `context`, `ContextOptions` | Install the context middleware on a bare Express app — [Using an existing app](../../guide/getting-started/existing-express/) |
| `hooks`, `createAppHooks`, `AppHooks`, `HooksOptions`, `RequestLogOptions` | Install app-level hooks on a bare Express app — [Hooks](../../guide/core/hooks/) |

## Router

| Export | What it is |
|---|---|
| `Router`, `RouterCtx` | The chainable router — [Router](../../guide/core/router/) |
| `RouteBuilder`, `RouteInfo`, `RouteState`, `RouteSchemas`, `RouteResponse`, `RouterOptions`, `RouterHooks`, `HttpMethod`, `BodylessMethod`, `Handler`, `HandlerCtx`, `HandlerReturn` | Route builder and metadata types |
| `StaticInfo`, `StaticOptions`, `RedirectInfo` | Types for `.static()` and `.redirect()` |
| `paramNames`, `ParamKeys`, `PathParams`, `joinPath` | Path-string parsing utilities behind `.params()` type inference |
| `markHandled`, `ROUTER_HANDLED`, `wasHandledByRouter` | Marks used internally to prevent app hooks from double-observing an error already seen by a router — see [Hooks: ordering](../../guide/core/hooks/#ordering-and-the-once-per-error-guarantee) |

## Middleware

| Export | What it is |
|---|---|
| `Middleware`, `CtxMiddleware`, `CtxMiddlewareFor`, `ExpressMiddleware`, `AnyMiddleware`, `Next`, `MiddlewareResult`, `AddsOf`, `AddsOfAll` | Middleware types and narrowing — [Middleware](../../guide/core/middleware/) |
| `guard` | One-line check-or-throw middleware — [Middleware: ctx middleware and narrowing](../../guide/core/middleware/#ctx-middleware-and-narrowing) |
| `toExpress` | Convert a `ctx` middleware to a plain Express `RequestHandler` |
| `isDescriptor`, `RouteSkip` | Internals behind response descriptors and the four things a middleware may do |

## Context

| Export | What it is |
|---|---|
| `Ctx`, `BaseCtx`, `TypedCtx`, `CtxKind`, `CtxCookies`, `CtxHeaders`, `CookieOptions`, `DefaultHeaders`, `DefaultQuery` | The per-request context type — [Context](../../guide/core/ctx/) |
| `createCtx`, `CtxOptions`, `ctxOf`, `ensureCtx`, `RequestContext` | Constructing and reading a context, for bare-Express integration |
| `currentCtx`, `requireCtx`, `currentBaseCtx`, `runWithCtx`, `RunWithCtxOptions` | Ambient context — [Logging: ambient context](../../guide/core/logging/#ambient-context) |

## Responses

| Export | What it is |
|---|---|
| `ResponseDescriptor`, `JsonResponse`, `TextResponse`, `RedirectResponse`, `FileResponse`, `DownloadResponse`, `StreamResponse`, `EmptyResponse`, `RawResponse`, `ResponseInit`, `ResponseHeaders`, `RESPONSE` | Response descriptor types — [Responses](../../guide/core/responses/) |

## Errors

| Export | What it is |
|---|---|
| `HttpError`, `isHttpError`, `defineError` | The base class and factory — [Errors](../../guide/core/errors/) |
| `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `MethodNotAllowed`, `Conflict`, `Gone`, `PayloadTooLarge`, `Unprocessable`, `TooManyRequests`, `Internal`, `ServiceUnavailable` | The built-in `HttpError` subclasses — full table in [error codes](../error-codes/) |
| `errorHandler`, `ErrorHandlerOptions`, `MappedError`, `notFound`, `classifyError`, `defaultEnvelope` | The error handler and its classification logic |

## Hooks

| Export | What it is |
|---|---|
| `RequestHook`, `ResponseHook`, `ErrorHook` | Hook function types — [Hooks](../../guide/core/hooks/) |

## Config

| Export | What it is |
|---|---|
| `defineConfig`, `Config`, `ConfigShape`, `DefineConfigOptions`, `InferConfig`, `InferConfigInput` | Boot-time config resolution — [Config](../../guide/core/config/) |
| `ConfigError`, `ConfigIssue` | The error thrown when config is invalid |
| `env`, `EnvSchema`, `LeafOptions`, `envName` | Environment-variable leaves and the path-to-variable-name converter |
| `resolveConfig` | For writing your own module option fragment — [Config: module fragments](../../guide/core/config/#module-fragments) |

## Logging

| Export | What it is |
|---|---|
| `log`, `Logger`, `LogFn`, `LogLevel` | The ambient logger proxy — [Logging](../../guide/core/logging/) |
| `configureLogger`, `createLogger`, `getRootLogger`, `PinoLogger`, `LoggerOptionsInput`, `DEFAULT_REDACT`, `LOG_LEVELS` | Building and reading the root logger outside `createApp` |

## Events

| Export | What it is |
|---|---|
| `createEvents`, `Events`, `EventsOptions`, `EventMap`, `EventSchemas`, `EventMeta`, `Listener`, `ListenerError`, `ErrorListener`, `MatchingNames`, `PayloadOf` | The in-process event bus — [Events](../../guide/core/events/) |

## Cache

| Export | What it is |
|---|---|
| `createCache`, `redisStore`, `Cache`, `CacheOptions`, `CacheScope`, `TaggedCache`, `SetOptions` | The cache API — [Cache](../../guide/core/cache/) |

## Schema and utilities

| Export | What it is |
|---|---|
| `StandardSchemaV1`, `InferInput`, `InferOutput`, `StandardIssue`, `StandardFailure`, `StandardSuccess`, `StandardResult`, `StandardPathSegment`, `StandardSchemaProps`, `StandardTypes` | The [Standard Schema](https://standardschema.dev) types every `.body()`/`.query()`/etc. schema satisfies |
| `runSchema`, `SchemaOutcome`, `toIssues`, `ValidationDetails`, `ValidationIssue`, `ValidationSection`, `validationError` | Internals behind route validation |
| `parseDuration`, `parseBytes` | Duration and byte-size string parsing — [reference](../durations-and-sizes/) |
| `MaybePromise`, `Simplify`, `UnionToIntersection` | Generic TypeScript helper types used across the public API |
| `UPLOAD_ISSUE_CODES`, `UploadedFile`, `UploadFieldSpec`, `UploadFieldsSpec`, `UploadIssueCode`, `UploadIssueMeta`, `UploadMessage`, `UploadMessages`, `UploadsOf` | Upload types available from the core package for typing `.uploads()`, even before installing `notio/upload` |

## `notio/auth`

| Export | What it is |
|---|---|
| `createAuth`, `Auth`, `CreateAuthConfig`, `IssueTokensResult` | [Auth](../../guide/modules/auth/) |
| `AuthAdapter`, `checkAdapter`, `AdapterMethod`, `AdapterRequirement`, `CreateSessionInput`, `UpdateSessionInput`, `SessionRecord` | The adapter contract |
| `cookieSession`, `CookieSessionOptions`, `jwt`, `JwtOptions`, `JwtKeyPair`, `JwtStrategy`, `opaque`, `OpaqueOptions`, `OpaqueStrategy`, `apiKey`, `ApiKeyOptions`, `custom`, `CustomOptions` | The five strategy factories |
| `Strategy`, `StrategyDeps`, `AuthOutcome`, `authenticated`, `invalid`, `absent`, `HasId` | Writing a custom strategy |
| `RequireOptions`, `OptionalOptions`, `AUTH_REQUIREMENT`, `AuthRequirement`, `getAuthRequirement` | `require()`/`optional()` and the marker the OpenAPI module reads |
| `csrf`, `CsrfOptions` | Double-submit CSRF protection |
| `scrypt`, `ScryptOptions`, `argon2`, `Argon2Options`, `PasswordHasher` | Password hashing |
| `currentUser`, `requireUser` | Reading the current user via ambient context |
| `hashToken`, `randomToken`, `initialExpiry`, `rollSession`, `ROLL_THROTTLE_MS` | Token internals, exposed for a custom adapter or strategy |

## `notio/upload`

| Export | What it is |
|---|---|
| `uploads`, `UploadsOptions`, `uploadConfig` | [Uploads](../../guide/modules/upload/) |
| `UploadedFileImpl` | The concrete class behind the `UploadedFile` interface |
| `sanitizeFilename`, `detectType`, `matchesTypes`, `sweepTempDir`, `resolveMessage`, `createParser`, `ResolvedUploadOptions` | Internals, exposed for testing or a custom parser |

## `notio/rate-limit`

| Export | What it is |
|---|---|
| `rateLimit`, `RateLimitOptions`, `RateLimitInfo` | [Rate limiting](../../guide/modules/rate-limit/) |
| `MemoryStore`, `createConsumer`, `BackendOptions`, `Consume`, `Algorithm`, `ConsumeArgs`, `ConsumeResult`, `RedisLike` | The backend abstraction, for writing your own store |

## `notio/openapi`

| Export | What it is |
|---|---|
| `openapi`, `OpenApiBuilder`, `OpenApiSpec`, `RouteSource` | [OpenAPI](../../guide/modules/openapi/) |
| `buildDocument`, `OpenApiDocument`, `OpenApiOptions`, `OpenApiInfo`, `OpenApiServer`, `Contact`, `SecurityScheme` | The document builder, if you want the spec without the docs UI |
| `createDocsRouter` | The Scalar UI router `spec.docs()` returns |
| `convertSchema`, `SchemaConverters`, `JsonSchema`, `ComponentRegistry` | Standard Schema → JSON Schema conversion, for a custom `schemaConverters` entry |
| `errorSchemaRef`, `errorStatusAndCode`, `getAuthRequirement`, `AuthRequirement`, `uploadsRequestSchema`, `toOpenApiPath` | Internals behind the generated document |
