---
title: createApp
---

`createApp` builds a real Express application with naive's pieces wired in the right order: context, body parsing, health routes, your routes, then error handling. This page covers what it wires, in what order, and its lifecycle hooks.

```ts
import { createApp } from "@jetframez/naive";
import { orders } from "./orders.js";

const app = createApp({
  logger: { level: "info" },
  cookies: { secret: process.env.COOKIE_SECRET },
  body: { json: { limit: "1mb" } },
  health: { path: "/health", ready: "/ready" },
});

app.use(cors(), helmet());
app.mount(orders);                       // at the router's own prefix
app.mount("/api/v1", users, billing);    // under a prefix
app.static("/assets", "./public", { maxAge: "1d" });
app.redirect("/docs", "/docs/", 301);
app.errors({ expose: process.env.NODE_ENV !== "production" });

await app.listen(3000);
```

## Ordering

Everything is registered when `listen()` runs, so the order you call `use`, `mount`, `static`, `errors` and the rest does not matter — only the fixed order below does. See [How a request flows](../../getting-started/request-flow/) for how this continues inside a matched route.

1. Context: `ctx`, ambient context, app-level hooks, the request log line.
2. Body parsers.
3. `/health` and `/ready`, before any user middleware so auth cannot block them.
4. Your `use`, `mount`, `static` and `redirect` calls, in the order you made them.
5. The 404 handler.
6. The error handler, configured through `app.errors()`.

:::caution[Never register your own error handler]
Register error handling through `app.errors({ map, format, expose })`, documented in [Errors](../errors/). Adding your own four-argument error middleware with `app.use()` runs alongside naive's, not instead of it, and receives errors naive's own handling has already classified.
:::

`app.express` is the Express instance itself. Anything registered on it directly runs before all of the above, which is the point of the escape hatch, but it also means naive's ordering does not apply to it.

## Middleware at app level

`app.use()` accepts Express `(req, res, next)` handlers and naive `(ctx, next)` middleware, mixed freely — see [Middleware](../middleware/) for the full rules. App-level middleware runs for every request, including ones no route matches, so it is the place for `cors()`, `helmet()` and similar. A naive middleware at app level sees `await next()` resolve when the response has finished: it can observe the status, but headers can no longer be changed at that point. Router-level middleware, which sends after the chain unwinds, is the place for header mutation after `next()`.

## Lifecycle

```ts
app.onStart(async () => db.connect());       // before binding; awaited in order
app.onReady(() => log.info("serving"));      // after binding; /ready turns 200 afterwards
app.onShutdown(async () => db.close());      // after draining, before close() resolves

const server = await app.listen(port, () => { /* Express-style callback, after onReady */ });
await app.close();
```

`listen()` resolves once the socket is bound and `onReady` hooks have run. `close()` stops accepting connections, closes idle keep-alive connections, waits for in-flight requests up to the deadline, then closes whatever remains, runs `onShutdown` hooks and resolves. Calling `close()` twice is safe. On SIGTERM or SIGINT the same happens, followed by `process.exit`.

`/health` answers 200 as soon as the server listens. `/ready` answers 503 while `onReady` hooks run and again once `close()` starts, so a load balancer stops routing new traffic during the drain. Neither is written to the request log.

## Route metadata

`app.routes()` returns `RouteInfo` for every route in every mounted router, with mount prefixes applied. The [OpenAPI module](../../modules/openapi/) reads it.

## Options

| Option | Default | Meaning |
|---|---|---|
| `logger` | `{}` | Root logger options — see [Logging](../logging/) — plus `startup: false` to silence listen and shutdown lines. An existing `Logger` is accepted. |
| `cookies.secret` | none | Key or keys for signed cookies; the first signs, all verify. |
| `body.json` | `{ limit: "1mb" }` | JSON parsing. `false` disables. |
| `body.urlencoded` | `false` | Form parsing, off by default. |
| `health` | `{ path: "/health", ready: "/ready" }` | Liveness and readiness endpoints; either can be `false`, or the whole option. |
| `shutdown.deadline` | `"10s"` | How long in-flight requests may take before their connections are closed. |
| `shutdown.signals` | `true` | Handle SIGTERM and SIGINT by closing and exiting. Turn off in tests — see [Testing](../../guides/testing/) — or when embedding. |
