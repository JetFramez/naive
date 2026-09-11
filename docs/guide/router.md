# Router

The router is chainable and typed. You declare a path, optional schemas and middleware, then hand it a handler. The router owns the send step: whatever the handler returns becomes the response.

```ts
import { Router } from "@jetframez/notio";
import { z } from "zod";

const orders = new Router("/orders");

orders
  .get("/:id")
  .params(z.object({ id: z.coerce.number() }))
  .query(z.object({ expand: z.array(z.string()).optional() }))
  .summary("Fetch one order")
  .handle(async (ctx) => {
    ctx.params.id; // number
    ctx.query.expand; // string[] | undefined
    return findOrder(ctx.params.id);
  });
```

This page covers the type layer. Runtime behaviour (validation, response conventions, Express compilation) is documented alongside milestone M1.

## Path params

Parameters are inferred from the path string, including the router prefix and any group prefixes above the route.

| Path | `ctx.params` |
|---|---|
| `"/orders/:id/lines/:lineId"` | `{ id: string; lineId: string }` |
| `"/files/*path"` | `{ path: string }` |
| `"/files/:name.:ext"` | `{ name: string; ext: string }` |
| `"/users{/:id}"` | `{ id?: string }` |
| `"/orders"` | `{}` |

Path syntax follows Express 5 (`path-to-regexp` v8): `:name` and `*name` parameters, `{...}` optional groups. A path typed as plain `string` falls back to `Record<string, string>`.

```ts
new Router("/orgs/:orgId").group("/projects", (r) => {
  r.get("/:projectId").handle((ctx) => {
    ctx.params; // { orgId: string; projectId: string }
  });
});
```

### `.params(schema)`

A params schema must declare exactly the parameters in the path. Anything else is a compile error whose message names the offending keys. The schema may transform values; path values always arrive as strings.

```ts
orders.get("/:id").params(z.object({ id: z.coerce.number() })); // ctx.params: { id: number }
orders.get("/:id").params(z.object({ orderId: z.string() }));   // error: missing "id", extra "orderId"
```

## Schemas: query, body, headers, response

`.query()`, `.body()`, `.headers()` and `.response()` accept any [Standard Schema](https://standardschema.dev) value. Zod, Valibot and ArkType all work; notio has no dependency on any of them.

```ts
import * as v from "valibot";
import { type } from "arktype";

router.post("/a").body(v.object({ name: v.string() }));
router.post("/b").body(type({ name: "string" }));
```

- `.body()` is not offered on `GET`, `DELETE`, `HEAD` or `OPTIONS` routes.
- Without a schema, `ctx.query` is `Record<string, string | string[]>`, `ctx.body` is `unknown`, and `ctx.headers.all()` is `Record<string, string | string[] | undefined>`.
- `.response(schema)` constrains what the handler may return: a value of the schema's output type, or a response descriptor from `ctx.json()` and friends. `.response(status, schema)` is documentation only.

## Middleware and `ctx` narrowing

A `Middleware<Adds>` declares what it puts on `ctx`. Everything after it in the chain sees those fields as present, at router, group and route level.

```ts
import type { Middleware } from "@jetframez/notio";

const authed: Middleware<{ user: User }> = async (ctx, next) => {
  ctx.user = await lookup(ctx.bearer()); // ctx.user is User | undefined inside
  await next();
};

const router = new Router("/orders").use(authed);
router.get("/:id").handle((ctx) => ctx.user.id); // User, not undefined

router.group("/admin", [requireAdmin], (r) => { /* r sees user and whatever requireAdmin adds */ });

router.post("/").use(rateLimited).handle((ctx) => ctx.user.id);
```

Narrowing follows the chained value. `router.use(authed)` returns the narrowed router; if you discard that return value, `router.get(...)` is not narrowed (the middleware still runs).

Inline `(ctx, next)` arrows are typed with the state of the chain at that point, so `ctx.params`, `ctx.body` and earlier `Adds` are all available.

### Express middleware

Anything with the Express `(req, res, next)` or `(err, req, res, next)` shape is accepted unchanged, mixed freely with ctx middleware:

```ts
router.use(cors(), helmet(), authed);
```

Declared Express middleware needs no annotations. An inline Express arrow must annotate its parameters (`(req: Request, res: Response, next: NextFunction) => ...`) or be typed as `RequestHandler`; this is the same TypeScript limitation Express has for inline error handlers.

Arity is the discriminator: two parameters means ctx middleware, three or four means Express.

## Global `Ctx` augmentation

`Ctx` is a plain, augmentable interface. Add fields that every request carries:

```ts
declare module "@jetframez/notio" {
  interface Ctx {
    user?: User;
  }
}
```

A typed route context (`TypedCtx<P, B, Q, H>`) is always assignable to `Ctx`, so helpers taking `Ctx` accept it:

```ts
function audit(ctx: Ctx) { ctx.log.info({ route: ctx.route }, "audit"); }
router.get("/:id").params(schema).handle((ctx) => { audit(ctx); });
```

## Uploads

`.uploads({...})` types `ctx.uploads` from the field spec: a single `UploadedFile`, an `UploadedFile[]` when `maxCount` is set, and `| undefined` when `optional: true`. The upload module supplies the runtime.

## Route metadata

`router.routes()` returns every route beneath the router, including groups and mounts, with full paths, parameter names, schemas, the middleware chain (outer to inner) and the documentation fields (`summary`, `tags`, `responses`, `errors`, `deprecated`, `hidden`). `router.statics()` and `router.redirects()` list the rest. Routes are recorded when `.handle()` is called.

Router-level `use()` applies to routes registered after it, as in Express. Groups copy the parent's middleware at creation; mounts copy it at mount time.
