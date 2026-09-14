# naive

`@jetframez/naive` is a TypeScript web framework whose transport layer is Express 5. It adds a typed, chainable router, a per-request context, unified errors, lifecycle hooks, structured logging, config, and optional modules for auth, uploads, rate limiting, cache, events and OpenAPI.

The scope and API shape are defined in [NOTIO_BRIEF.md](./NOTIO_BRIEF.md). All milestones (M0–M11) are implemented.

```ts
import { createApp, Router } from "@jetframez/naive";
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

Optional modules live at their own subpaths — `@jetframez/naive/auth`, `/upload`, `/rate-limit`, `/openapi` — each usable standalone or wired together by `createApp`.

## Layout

```
packages/core        @naive-internal/core     router, ctx, errors, hooks, ALS, logger, config, cookies, static, events, cache
packages/auth        @naive-internal/auth     sessions, JWT, opaque tokens with rotation, password hashing
packages/upload      @naive-internal/upload   multipart parsing, content-sniffed type detection
packages/rate-limit  @naive-internal/rate-limit  fixed window, sliding window, token bucket
packages/openapi     @naive-internal/openapi  OpenAPI 3.1 generation, Scalar docs UI
packages/naive       @jetframez/naive         published façade; re-exports the above via subpaths, internal packages inlined
examples/            runnable apps, type-checked in CI, walked through in the docs site
docs/                Starlight (Astro) guide site
```

Only `@jetframez/naive` is published; the `@naive-internal/*` packages exist for architectural boundaries (each may only import what its own `package.json` declares) and are inlined into the façade's build output, never installed by consumers.

## Commands

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter @jetframez/naive verify   # confirms the built package has no leftover workspace-package imports
pnpm --filter minimal start             # run an example
pnpm --filter naive-docs dev            # docs site at localhost, pages under docs/src/content/docs
```

Node ≥ 22, pnpm 12.

## Releasing

Describe a change with `pnpm changeset` (only `@jetframez/naive` is ever versioned; the internal packages are excluded). Pushing to `main` with pending changesets opens a "Version Packages" PR via the `release.yml` workflow.

Merging that PR does **not** publish by itself. `NPM_TOKEN` is a stage-only granular token — npm is retiring tokens that can publish directly (see [Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/)), and `changeset publish` has no native support yet for npm's staged-publish flow ([changesets/changesets#2025](https://github.com/changesets/changesets/issues/2025)). So the merge only stages the new version on the registry, not public yet. To finish the release, a maintainer runs, locally, with their own npm login:

```sh
npm stage list                # find the staged version's id
npm stage view <id>            # optional: inspect what's about to go live
npm stage approve <id>          # publishes it — prompts for 2FA, cannot be scripted
```

This is a deliberate, permanent step, not a one-time setup task — every release needs it. `npm stage reject <id>` discards a staged version instead of publishing it. Needs npm CLI ≥ 11.15.0 locally (`npm install -g npm@latest` if `npm stage` isn't found).

**The very first publish of the package** is the one exception: `npm stage publish` only stages a new version of a package that already exists on the registry, so it can't create `@jetframez/naive` for the first time — that one has to be a real, manual, 2FA-verified publish. Do it with `pnpm publish`, not `npm publish`: this package's dependencies use pnpm's `catalog:` workspace protocol, which plain `npm publish`/`npm pack` doesn't understand and would publish literally, breaking the package for every installer. `pnpm publish` (and `pnpm pack`, which `release.yml` uses for every subsequent staged release) resolves it to real version numbers first.

```sh
cd packages/naive
pnpm build
pnpm publish --no-git-checks --no-provenance --otp=<code>
```

(`--no-provenance` because provenance attestations can only be generated on a supported CI runner, never from a local machine, regardless of which tool does the publishing.)

## Docs site

Live at <https://jetframez.github.io/naive/>. A push to `main` that touches `docs/` builds and deploys it automatically via the `deploy-docs.yml` workflow (GitHub Pages, GitHub Actions as the build source). Trigger a rebuild without a code change from the Actions tab: "Deploy docs" → "Run workflow".
