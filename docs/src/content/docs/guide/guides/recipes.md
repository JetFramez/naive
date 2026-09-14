---
title: Recipes
---

Short, self-contained patterns that combine pieces documented elsewhere. Each links back to the page with the full explanation.

## Pagination with a query schema

```ts
const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get("/orders").query(PageQuery).handle(async (ctx) => {
  const { items, nextCursor } = await db.orders.page(ctx.query);
  return { items, nextCursor };
});
```

`z.coerce.number()` is required — query values always arrive as strings. See [Router: schemas](../../core/router/#schemas-query-body-headers-response).

## Auth plus rate limiting on a login route

Order matters: rate limit before the expensive work, key by the identity being attacked rather than the caller's IP alone, so one IP can't lock out every account and one attacker can't be stopped by rotating IPs alone.

```ts
router
  .post("/login")
  .use(rateLimit({ limit: 5, window: "15m", key: (ctx) => ctx.body?.email ?? ctx.ip }))
  .body(z.object({ email: z.string().email(), password: z.string() }))
  .handle(async (ctx) => {
    const user = await auth.verifyPassword(ctx.body.email, ctx.body.password);
    await auth.login(ctx, user);
    return { id: user.id };
  });
```

See [Rate limiting](../../modules/rate-limit/) and [Auth: passwords](../../modules/auth/#passwords).

## Uploading a file to S3

`move()` relocates the file; where it goes is up to you. Move to a local staging path or hand the stream/buffer directly to your SDK's upload call, then discard the local copy.

```ts
router
  .post("/avatar")
  .uploads({ file: { types: ["image/*"], maxSize: "5mb" } })
  .handle(async (ctx) => {
    const key = `avatars/${ctx.params.userId}.jpg`;
    await s3.putObject({ Bucket: "assets", Key: key, Body: ctx.uploads.file.stream() });
    await ctx.uploads.file.discard(); // already read via stream(); no local copy to keep
    return { key };
  });
```

See [Uploads: `UploadedFile`](../../modules/upload/#uploadedfile).

## Translating database errors into your own codes

```ts
app.errors({
  map: (err, ctx) => {
    if (isUniqueViolation(err)) return new Conflict("Email already registered", { field: "email" });
    return undefined; // fall through to default classification for everything else
  },
});
```

See [Errors: classification](../../core/errors/#classification).

## Tenant scoping with ambient context

Augment `Ctx` with a `tenant` field, set it in middleware, and read it anywhere — including deep inside a service that has no `ctx` parameter — via `currentCtx()`.

```ts
declare module "@jetframez/naive" {
  interface Ctx {
    tenant?: { id: string };
  }
}

const tenantMiddleware: Middleware<{}> = async (ctx, next) => {
  ctx.tenant = await resolveTenant(ctx.headers.get("x-tenant"));
  await next();
};

// deep in a service, no ctx passed in:
function currentTenantId(): string {
  return requireCtx().tenant?.id ?? throwMissingTenant();
}
```

See [Context: augmenting `Ctx`](../../core/ctx/#augmenting-ctx) and [Logging: ambient context](../../core/logging/#ambient-context).

## Publishing the OpenAPI spec in CI

`spec.document` is a plain object — write it to a file without ever calling `listen()`:

```ts
// scripts/export-openapi.ts
import { writeFileSync } from "node:fs";
import { openapi } from "@jetframez/naive/openapi";
import { app } from "../src/app.js"; // however you build and mount routers

const spec = openapi({ info: { title: "Shop API", version: "1.0.0" } }).from(app);
writeFileSync("openapi.json", JSON.stringify(spec.document, null, 2));
```

Run this as a CI step to diff the committed spec against what the code actually produces, or to feed a separate client-generation tool. See [OpenAPI](../../modules/openapi/).
