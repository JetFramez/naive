---
title: Using notio in an existing Express app
---

`createApp` wires everything for you, but nothing requires it. Every piece works standalone on an `express()` app you already have, so you can adopt notio one router at a time.

## The minimum: context and a router

`context()` is what `createApp` installs internally: it creates `ctx`, enters the `AsyncLocalStorage` for [ambient context](/guide/core/logging#ambient-context), and writes the one-line-per-request log. Install it before any router.

```ts
import express from "express";
import { context, Router } from "@jetframez/notio";

const app = express();
app.use(express.json()); // notio does not install body parsers for you here
app.use(context({ logger, cookieSecret: process.env.COOKIE_SECRET }));

const orders = new Router("/orders");
orders.get("/:id").handle((ctx) => findOrder(ctx.params.id));

app.use(orders); // full paths, including the router's own prefix
```

A `Router` also enters the context store for its own chains on demand, so a route still gets a working `ctx` even without `context()` installed — but the request log line, `ctx.log`, and ambient `currentCtx()` outside the router need it explicitly.

| Option | Meaning |
|---|---|
| `logger` | An existing `Logger`, or omit it to use the root logger. |
| `cookieSecret` | Key or keys for signed cookies, same as `createApp({ cookies })`. |
| `requestLog` | `false` to disable the request log line, or `{ ignore }` to skip specific paths. |

## Error handling

Register the 404 handler and the error handler last, after every router — same rule as any Express app.

```ts
import { errorHandler, notFound } from "@jetframez/notio";

app.use(orders);
app.use(notFound());
app.use(errorHandler({ expose: process.env.NODE_ENV !== "production" }));
```

See [Errors](/guide/core/errors) for `map`, `format`, and how classification works.

## Hooks

`hooks()` installs the same context middleware as `context()`, plus app-level observers.

```ts
import { hooks } from "@jetframez/notio";

hooks(app, {
  onRequest: [(ctx) => metrics.inc("requests")],
  onResponse: (ctx, result) => metrics.observe("status", ctx.res.statusCode),
  onError: (ctx, err) => reporter.capture(err),
});

app.use(orders);
```

Call `hooks()` or `context()` once, before routes — not both. See [Hooks](/guide/core/hooks) for ordering and the once-per-error guarantee.

## Mixing plain Express routes and notio routers

Nothing about this is exclusive. A `Router` is Express middleware, so it can sit next to `app.get(...)` calls, other routers, and third-party middleware in any order Express would normally allow:

```ts
app.get("/legacy/report", legacyReportHandler); // untouched, plain Express
app.use(orders); // a notio Router
app.use("/v2", accounts.express()); // the compiled express.Router, if you want the raw instance
```

A plain Express route that throws still reaches the notio error handler if one is registered last — it just never passes through a router's `onError` hooks, since those only see errors from routes the router itself handles.

## Moving to `createApp` later

`createApp` is `context()` + body parsers + health routes + `errorHandler()` + graceful shutdown, registered in the order in [How a request flows](/guide/getting-started/request-flow). None of the code above changes when you switch — `app.mount(orders)` replaces `app.use(orders)`, and the manual `notFound()`/`errorHandler()` calls go away because `createApp` installs them for you.
