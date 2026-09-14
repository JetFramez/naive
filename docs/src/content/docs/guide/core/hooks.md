---
title: Hooks
---

Hooks observe requests. They cannot change the response, and they are the place for side effects such as metrics, audit trails and error reporting. Three hooks exist at two levels.

| Hook | Router level | App level |
|---|---|---|
| `onRequest(ctx)` | when a route of that router matched, before its middleware | first thing, for every request |
| `onResponse(ctx, result?)` | after the response was sent, with the handler's return value | when the response finishes, with the return value if a naive route produced one |
| `onError(ctx, error)` | once, before the error is forwarded to the error handler | once per error, see below |

```ts
const router = new Router("/orders")
  .onRequest((ctx) => metrics.inc("orders.requests"))
  .onError((ctx, err) => reporter.capture(err, { requestId: ctx.requestId }));

app.onResponse((ctx) => metrics.observe("latency", ctx.res.statusCode));
```

## Ordering and the once-per-error guarantee

Router-level hooks run before app-level ones. When a route throws, the router runs its own `onError` hooks, then the app's, and marks the error. The error handler sees the mark and does not run app hooks again. Errors that never passed through a naive router, such as a plain Express route throwing or the 404 handler, reach the error handler unmarked, and it runs the app hooks itself. Either way every error is observed exactly once at each level.

Nested routers (groups and mounts) inherit the hooks of the routers above them, outer first.

App-level `onRequest` runs at the start of the request, before routing, so it fires before any router-level `onRequest`. That is the one place the "router before app" rule does not apply, because unmatched requests would otherwise never be observed.

## Failure behaviour

A throwing `onRequest` hook fails the request: the error goes to the error handler like any other. Throwing `onResponse` and `onError` hooks are logged at `error` level and otherwise ignored, so an observer bug cannot break a response that was already sent.

## On a bare Express app

`hooks(app, { onRequest, onResponse, onError })` installs the same context middleware `createApp` uses, plus these app-level hooks — call it once, before routes. See [Using naive in an existing Express app](../../getting-started/existing-express/#hooks) for the full example. Calling it more than once adds more hooks; each request still gets one context.
