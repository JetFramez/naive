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

The first half of this page is the type layer; the second half is what happens at runtime.

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

## Runtime

### Express is the transport

A `Router` instance is Express middleware. On a bare Express app:

```ts
const app = express();
app.use(express.json());
app.use(orders);                    // full paths, including the router prefix
app.use("/v2", orders.express());   // or mount the compiled express.Router yourself
```

Each route compiles to one Express handler that runs the whole chain: router and group middleware, validation, route middleware, then the handler. Routes registered after the first request are picked up automatically.

Because middleware compiles per route, router-level middleware runs only for requests that match one of the router's routes, statics or redirects. Put `cors()`, `helmet()` and other "every request" middleware on the app, where Express runs them for unmatched paths and preflights too.

### The chain

Middleware runs in registration order, outer to inner, and unwinds after `await next()`. The router sends the response after the chain has fully unwound, so middleware can still set headers after `next()`:

```ts
router.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  ctx.set("x-elapsed", String(Date.now() - start));
});
```

A middleware must do one of four things: call `next()`, throw, respond through `ctx.res`, or return a response descriptor without calling `next()`. Doing none of them raises `Internal("middleware ended without responding or calling next()")`.

Errors are thrown, never passed to `next(err)`. The router catches them and forwards them to Express's error path, where the notio error handler (or your own) renders them.

Express middleware in the chain keeps Express semantics: `next()` continues, `next(err)` becomes a thrown error, `next("route")` skips to the next matching route, and ending the response without calling `next()` stops the chain. A four-argument `(err, req, res, next)` handler sees errors thrown by anything after it in the chain.

`guard()` covers one-line checks:

```ts
router.use(guard((ctx) => ctx.user.role === "admin", () => new Forbidden()));
```

### Validation

Validation runs after router and group middleware and before route middleware, in the order params, query, headers, body. Only the first failing section is reported, as `Unprocessable` (422):

```json
{
  "code": "VALIDATION",
  "message": "Invalid body",
  "details": {
    "in": "body",
    "issues": [{ "path": "items.1.qty", "code": "too_small", "message": "..." }]
  },
  "requestId": "..."
}
```

- Path params and query values arrive as strings; use coercion in the schema (`z.coerce.number()`).
- A single query value is promoted to a one-element array when the schema wants an array, so `?tags=a` and `?tags=a&tags=b` both validate against `z.array(z.string())`.
- Unknown keys follow the schema's own policy. Zod and Valibot strip them by default; use `.strict()` to reject.
- Header names are lower-case. After validation `ctx.headers.all()` returns the validated object; `ctx.headers.get()` always reads the raw request.
- The body is whatever the body parser put on `req.body`. `createApp` installs JSON and urlencoded parsers; on bare Express, install `express.json()` yourself.

`.response(schema)` validates the return value outside production (`NODE_ENV !== "production"`) and throws `Internal` on mismatch, so a wrong shape fails loudly in development and costs nothing in production. Disable it per router with `new Router(prefix, { validateResponses: false })`.

### Responses

| Handler returns | Response |
|---|---|
| `string` | `text/plain`, 200 |
| object, array, number, boolean, `null` | JSON, 200 (201 for POST) |
| `undefined` | 204, empty body |
| `Buffer` or `Readable` | bytes or a stream, `application/octet-stream` unless a type was set |
| a descriptor from `ctx.json()`, `ctx.text()`, `ctx.redirect()`, `ctx.file()`, `ctx.download()`, `ctx.stream()`, `ctx.empty()`, `ctx.raw()` | as described by the descriptor |
| the handler already wrote to `ctx.res` | nothing; a warning is logged if a value was also returned |

`ctx.status(code)` and `ctx.set(name, value)` apply to plain returns. A descriptor's own status and headers take precedence.

### Statics and redirects

```ts
router.static("/assets", "./public", { maxAge: "1d", immutable: true });
router.static("/app", "./dist", { spa: true });   // serves index.html for unmatched GETs that accept HTML
router.redirect("/old", "/new");                  // 302
router.redirect("/gone", "/elsewhere", 301);
```

Both inherit the router's prefix and middleware. `maxAge` accepts a duration string. Everything else is passed to `express.static`.

### Hooks

`router.onRequest(fn)`, `router.onResponse(fn)` and `router.onError(fn)` observe requests handled by the router and its groups and mounts. They cannot change the response. `onRequest` runs before the chain; `onResponse` runs after the response was sent, with the handler's return value; `onError` runs once with the thrown error before it is forwarded to Express, and the error is marked so app-level hooks do not run it again. Outer routers' hooks run before inner ones. A throwing `onRequest` hook fails the request; throwing `onResponse` or `onError` hooks are logged and ignored.

## Route metadata

`router.routes()` returns every route beneath the router, including groups and mounts, with full paths, parameter names, schemas, the middleware chain (outer to inner) and the documentation fields (`summary`, `tags`, `responses`, `errors`, `deprecated`, `hidden`). `router.statics()` and `router.redirects()` list the rest. Routes are recorded when `.handle()` is called.

Router-level `use()` applies to routes registered after it, as in Express. Groups copy the parent's middleware at creation; mounts copy it at mount time.
