# notio

`@jetframez/notio` is a TypeScript web framework whose transport layer is Express 5. It adds a typed, chainable router, a per-request context, unified errors, lifecycle hooks, structured logging, config, and optional modules for auth, uploads, rate limiting, cache, events and OpenAPI.

The scope and API shape are defined in [NOTIO_BRIEF.md](./NOTIO_BRIEF.md). All milestones (M0–M11) are implemented.

```ts
import { createApp, Router } from "@jetframez/notio";
import { z } from "zod";

const router = new Router("/orders");
router
  .post("/")
  .body(z.object({ total: z.number().positive() }))
  .handle((ctx) => ({ id: crypto.randomUUID(), total: ctx.body.total })); // -> 201 JSON

const app = createApp();
app.mount(router);
await app.listen(3000);
```

Optional modules live at their own subpaths — `@jetframez/notio/auth`, `/upload`, `/rate-limit`, `/openapi` — each usable standalone or wired together by `createApp`.

## Layout

```
packages/core        @notio-internal/core     router, ctx, errors, hooks, ALS, logger, config, cookies, static, events, cache
packages/auth        @notio-internal/auth     sessions, JWT, opaque tokens with rotation, password hashing
packages/upload      @notio-internal/upload   multipart parsing, content-sniffed type detection
packages/rate-limit  @notio-internal/rate-limit  fixed window, sliding window, token bucket
packages/openapi     @notio-internal/openapi  OpenAPI 3.1 generation, Scalar docs UI
packages/notio       @jetframez/notio         published façade; re-exports the above via subpaths, internal packages inlined
examples/            runnable apps, type-checked in CI, embedded in the docs site
docs/                VitePress guide site
```

Only `@jetframez/notio` is published; the `@notio-internal/*` packages exist for architectural boundaries (each may only import what its own `package.json` declares) and are inlined into the façade's build output, never installed by consumers.

## Commands

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter @jetframez/notio verify   # confirms the built package has no leftover workspace-package imports
pnpm --filter minimal start             # run an example
pnpm --filter notio-docs dev            # docs site at localhost, guide pages under docs/guide
```

Node ≥ 22, pnpm 12.

## Releasing

Describe a change with `pnpm changeset` (only `@jetframez/notio` is ever versioned; the internal packages are excluded). Pushing to `main` with pending changesets opens a "Version Packages" PR via the `release.yml` workflow; merging it publishes to npm, given an `NPM_TOKEN` repository secret with publish rights.
