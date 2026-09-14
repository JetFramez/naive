---
title: Middleware
---

A route's chain is router middleware, then group middleware, then route middleware, then validation, then the handler — see [How a request flows](../../getting-started/request-flow/) for where this sits relative to everything else. This page covers writing middleware, narrowing `ctx`, and mixing in the Express ecosystem.

## `ctx` middleware and narrowing

A `Middleware<Adds>` declares what it puts on `ctx`. Everything after it in the chain sees those fields as present, at router, group and route level.

```ts
import type { Middleware } from "@jetframez/naive";

const authed: Middleware<{ user: User }> = async (ctx, next) => {
  ctx.user = await lookup(ctx.bearer()); // ctx.user is User | undefined inside
  await next();
};

const router = new Router("/orders").use(authed);
router.get("/:id").handle((ctx) => ctx.user.id); // User, not undefined

router.group("/admin", [requireAdmin], (r) => { /* r sees user and whatever requireAdmin adds */ });

router.post("/").use(rateLimited).handle((ctx) => ctx.user.id);
```

:::caution[Keep the return value of `.use()`]
Narrowing follows the chained value. `router.use(authed)` returns the narrowed router; if you discard that return value, `router.get(...)` is not narrowed — the middleware still runs, but `ctx.user` is typed as if it were never added.
:::

Inline `(ctx, next)` arrows are typed with the state of the chain at that point, so `ctx.params`, `ctx.body` and earlier `Adds` are all available.

`guard()` covers one-line checks that either pass or throw:

```ts
router.use(guard((ctx) => ctx.user.role === "admin", () => new Forbidden()));
```

### Augmenting `Ctx` globally instead

`Middleware<Adds>` narrows for what comes after it in one chain. For a field every request carries regardless of which middleware ran, merge into the `Ctx` interface instead — see [Context: Augmenting `Ctx`](../ctx/#augmenting-ctx). Prefer `Middleware<Adds>` whenever the field is actually conditional on a specific middleware running, since a global augmentation makes the field optional everywhere, even on routes that never run that middleware.

## Express middleware

Anything with the Express `(req, res, next)` or `(err, req, res, next)` shape is accepted unchanged, mixed freely with `ctx` middleware:

```ts
router.use(cors(), helmet(), authed);
```

Declared Express middleware needs no annotations. An inline Express arrow must annotate its parameters (`(req: Request, res: Response, next: NextFunction) => ...`) or be typed as `RequestHandler`; this is the same TypeScript limitation Express has for inline error handlers.

Arity is the discriminator: two parameters means `ctx` middleware, three or four means Express.

`toExpress(middleware)` converts a `ctx` middleware into a plain Express `RequestHandler`, for handing to something that only accepts the Express shape.

## The chain, mechanically

Middleware runs in registration order, outer to inner, and unwinds after `await next()`. The router sends the response after the chain has fully unwound, so middleware can still set headers after `next()`:

```ts
router.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  ctx.set("x-elapsed", String(Date.now() - start));
});
```

A `ctx` middleware must do one of four things: call `next()`, throw, respond through `ctx.res`, or return a response descriptor without calling `next()`. Doing none of them raises `Internal("middleware ended without responding or calling next()")`.

Errors are thrown, never passed to `next(err)`. The router catches them and forwards them to Express's error path, where the naive error handler (or your own) renders them — see [Errors](../errors/).

Express middleware in the chain keeps Express semantics: `next()` continues, `next(err)` becomes a thrown error, `next("route")` skips to the next matching route, and ending the response without calling `next()` stops the chain. A four-argument `(err, req, res, next)` handler sees errors thrown by anything after it in the chain.

`RouteSkip` is what a `ctx` middleware returns internally to signal "the response was already sent, do not proceed" — you will not construct this yourself in ordinary use; `isDescriptor()` and the documented return conventions above cover what you write.

## Middleware at app level

`app.use()` on `createApp` accepts both shapes mixed freely, exactly like a router. The difference is scope: app-level middleware runs for every request, including ones no route matches, which is why `cors()`, `helmet()` and similar belong there rather than on a router. See [createApp: Middleware at app level](../app/#middleware-at-app-level).
