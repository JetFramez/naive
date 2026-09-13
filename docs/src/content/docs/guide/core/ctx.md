---
title: Context
---

Every request gets one `ctx`. Handlers and `(ctx, next)` middleware receive it; it is also stored on `res.locals.ctx` so Express middleware can reach it. `createApp` creates it first thing; a `Router` used on a bare Express app creates it on demand.

```ts
router.post("/orders/:id/notes").body(NoteSchema).handle(async (ctx) => {
  ctx.params.id;          // typed from the path
  ctx.body.text;          // typed from the schema
  ctx.query;              // Record<string, string | string[]> without a schema
  ctx.headers.get("x-trace");
  ctx.bearer();           // token from "Authorization: Bearer ..."
  ctx.log.info({ orderId: ctx.params.id }, "note added");
  return ctx.status(201).json(note);
});
```

## Fields

| Field | Meaning |
|---|---|
| `req`, `res` | The real Express request and response. Escape hatches, always available. |
| `params`, `query`, `body` | Validated and transformed by the route's schemas, or the raw values when there is no schema. |
| `headers` | `get(name)`, `has(name)`, `all()`, plus `set(name, value)` and `append(name, value)` for the response. |
| `requestId` | `X-Request-Id` from the request, otherwise a generated UUID. |
| `method`, `path`, `route` | Method, request path, and the matched pattern such as `"POST /orders/:id/notes"`. |
| `url` | A `URL` built from the full request URL. |
| `ip` | The client address; honours Express `trust proxy`. |
| `state` | A per-request scratch object for untyped data. |
| `log` | A child logger carrying `requestId`, `route` and anything bound with `ctx.bind(fields)`. |
| `kind` | `"http"`. Job and CLI contexts created with `runWithCtx` have their own kind. |

`bearer()` returns the bearer token or `undefined`. `accepts(...types)` wraps `req.accepts`. `bind(fields)` adds fields to every subsequent `ctx.log` line for the rest of the request — see [Logging: ambient context](../logging/#ambient-context).

`ctx.status(code)` and `ctx.set(name, value)` are chainable mutators for plain return values. When a handler returns a descriptor, the descriptor's status and headers win. See [Responses](../responses/) for the full set of return conventions, including `ctx.json()` and the other descriptor factories.

## Cookies

```ts
ctx.cookies.get("sid");
ctx.cookies.all();
ctx.cookies.set("sid", value, { maxAge: "30d" });
ctx.cookies.delete("sid");
ctx.cookies.setSigned("sid", value);
ctx.cookies.getSigned("sid");   // undefined when missing or tampered
```

Cookies are parsed lazily from the `Cookie` header. Writes go through `res.append("Set-Cookie")`, so several cookies can be set in one response. Defaults are `path: "/"`, `httpOnly: true`, `sameSite: "lax"`, and `secure` when the request is HTTPS (including behind a trusted proxy). `maxAge` accepts a duration string.

Signed cookies use HMAC-SHA256. Configure `createApp({ cookies: { secret } })`; pass an array to rotate keys, where the first key signs and every key verifies. `getSigned` and `setSigned` throw a clear error when no secret is configured.

## Augmenting `Ctx`

Add fields every request carries by merging into the interface:

```ts
declare module "@jetframez/notio" {
  interface Ctx {
    tenant?: Tenant;
  }
}
```

For fields a specific middleware adds, prefer `Middleware<{ user: User }>`, which narrows `ctx` for everything after it in the chain instead of making the field optional everywhere — see [Middleware](../middleware/#ctx-middleware-and-narrowing).

## Durations

Wherever notio takes a time (`maxAge`, TTLs, windows, deadlines) it accepts milliseconds as a number or a duration string: `"250ms"`, `"5s"`, `"5m"`, `"1.5h"`, `"30d"`, `"2w"`. Full grammar and byte-size strings (`"10mb"`) are in the [reference](../../../reference/durations-and-sizes/).
