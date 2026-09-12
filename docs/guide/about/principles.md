# Design principles

These are the rules the API is built to, not a style guide for using it. They explain *why* things are shaped the way they are — why there's no plugin registry, why errors are thrown instead of passed to `next(err)`, why a module exists at all.

## Express is the transport

`app.express` is always the real Express instance. Any `(req, res, next)` middleware from the ecosystem works unchanged. notio never wraps `cors`, `helmet`, `compression`, or similar — there is nothing to wrap; they already work.

## Wrap only when it adds behaviour

A module exists only if it needs `ctx`, produces errors that should join the unified error shape, needs types the ecosystem can't give, or participates in ambient context and hooks. Otherwise it stays userland, and you reach for whatever npm package already solves it.

## Own the interface, borrow the engine

Uploads are built on `busboy`. Logging is `pino`. JWTs go through `jose`. Cache stores are Keyv-compatible. notio writes the API surface — the types, the validation, the unified errors — and doesn't reimplement problems that are already solved well. Rate limiting is the one exception worth naming: it needs one thing a generic key-value interface can't offer, an atomic read-and-increment, so it's a small engine of its own rather than a wrapper — see [Rate limiting: why not the cache module's store option](/guide/modules/rate-limit#why-not-the-cache-modules-store-option).

## No decorators, no DI container, no middleware phases

The only global is `AsyncLocalStorage`, used for the request context. There is no dependency-injection container to configure and no lifecycle of named middleware phases to learn — middleware is a list, run in order.

## Handlers return values

The router owns the send step. You return a value or throw; you never call `res.send()` or `next(err)` yourself in ordinary use. This is why response handling, once learned, is the same shape everywhere — see [Responses](/guide/core/responses).

## Nothing implicit at boot

Modules are constructed by you and passed where needed. There is no plugin registry, no auto-discovery of files by naming convention, no side effect from importing a package. If a module's factory function isn't called, nothing about it exists.

## Fail at startup, not at first use

Config, missing adapter methods, and misconfigured strategies error at boot, with every problem listed together rather than one at a time as each is hit in production. `defineConfig`, `createAuth`, and `resolveConfig` all follow this — see [Config: errors at boot](/guide/core/config#errors-at-boot) and [Auth: the adapter](/guide/modules/auth#the-adapter).

## See also

[What notio does not do](./scope) covers the boundary these principles draw — the things that stay out of the framework because they'd violate one of the rules above, or because they're simply out of scope for this phase.
