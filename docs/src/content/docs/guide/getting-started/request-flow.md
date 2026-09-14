---
title: How a request flows
---

`createApp` and `Router` each register several pieces. This page is the map: what runs, in what order, for a request that succeeds and for one that fails. The rest of the guide documents each piece; this page is where they fit together.

## App level, registered at `listen()`

`createApp` lets you call `app.use()`, `app.mount()`, `app.static()`, `app.errors()` in any order — everything is actually wired when `listen()` runs, in this fixed order:

```
1. Context           ctx created, AsyncLocalStorage entered, app-level onRequest hooks, the request log line
2. Body parsers       JSON always; urlencoded only if you enabled it
3. Health routes       /health and /ready, before anything that could block them
4. Your registrations  use(), mount(), static(), redirect() — in the order you called them
5. 404 handler
6. Error handler       app.errors() configures it; never register your own
```

Two things fall outside this list:

- Anything you register directly on `app.express` runs **before all of it**. That is the point of the escape hatch, but it means naive's ordering guarantees do not apply to it.
- App-level `onRequest` hooks fire at step 1, before routing has happened at all — the one place a request is observed even if no router ends up matching it.

Full detail: [createApp](../../core/app/).

## Inside one route, once a router matches

A `Router` is Express middleware; each declared route compiles to one Express handler covering the whole chain below.

```
1. Router and group middleware    outer to inner, whatever was declared with .use() and group()
2. Validation, first failing wins  params → query → headers → uploads → body
3. Route middleware                declared with .use() on the specific route
4. Your handler
5. The send step                   the router turns the return value into a response
6. onResponse hooks                router-level, then app-level, with the return value
```

A thrown error at any point after step 1 skips straight to the router's `onError` hooks, then the app's, then the error handler — see [Errors](../../core/errors/) and [Hooks](../../core/hooks/).

Router-level `onRequest` hooks fire right before step 1, once a route of that router has actually matched — later than the app-level `onRequest` in the list above, and only for requests that match something in this router.

Full detail: [Router](../../core/router/), [Middleware](../../core/middleware/).

## Validation order and why it's ordered that way

Params and query never depend on the request body, so they run first and fail fast on a malformed URL before anything reads the body stream. Uploads run before `.body()` because, for a multipart request, the body parser and the upload parser are the same pass — the text fields uploads collect *are* what `.body()` validates. Only the first failing section is reported as a single 422.

## What the handler returns

The router owns the send step — you never call `res.send()` yourself in ordinary use. A plain object becomes JSON; `undefined` becomes 204; a descriptor from `ctx.json()`, `ctx.redirect()` and friends becomes exactly what it describes. See [Responses](../../core/responses/).

## Where things run relative to each other, end to end

For a single successful `POST` request through a mounted router:

```
app-level onRequest
  → context middleware already active (ctx exists from step 1 above)
  → body parser
  → router-level onRequest (this router matched)
  → router middleware → group middleware → route middleware (outer to inner)
  → validation (params, query, headers, uploads, body)
  → handler runs, returns a value
  → response sent
  → router-level onResponse → app-level onResponse
```

For a request that throws, from anywhere after the context middleware:

```
error thrown
  → router-level onError (once)
  → app-level onError (once — the error handler will not run these again)
  → error handler renders the unified envelope
```

## Next

- [Using naive in an existing Express app](../existing-express/) if you are not starting from `createApp`.
- [Testing](../../guides/testing/) for what this ordering means for driving requests in tests.
- [Production](../../guides/production/) for what changes between `development` and `production`.
