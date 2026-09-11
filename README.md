# notio

`@jetframez/notio` is a TypeScript web framework whose transport layer is Express 5. It adds a typed, chainable router, a per-request context, unified errors, lifecycle hooks, structured logging, config, and optional modules for auth, uploads, rate limiting, cache, events and OpenAPI.

The scope and API shape are defined in [NOTIO_BRIEF.md](./NOTIO_BRIEF.md). Work proceeds milestone by milestone as listed there.

## Layout

```
packages/core        @notio-internal/core     router, ctx, errors, hooks, ALS, logger, config, cookies, static, events, cache
packages/auth        @notio-internal/auth
packages/upload      @notio-internal/upload
packages/rate-limit  @notio-internal/rate-limit
packages/openapi     @notio-internal/openapi
packages/notio       @jetframez/notio         published façade
examples/            runnable apps, type-checked in CI
docs/                guide pages (VitePress site comes with M11)
```

## Commands

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Node ≥ 22, pnpm 12.
