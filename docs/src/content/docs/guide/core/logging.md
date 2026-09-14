---
title: Logging and ambient context
---

## The logger

notio logs through pino, behind a small `Logger` interface: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `child(fields)`, `isLevelEnabled(level)` and a `level` property. Each method takes either a message or a fields object followed by a message, as pino does.

```ts
import { log } from "notio";

log.info({ orderId }, "order placed");
log.error({ err }, "payment failed");
```

`createApp({ logger })` builds the root logger. Scripts and tests that do not go through `createApp` call `configureLogger()` instead; `createLogger()` returns a standalone instance without touching the root; `getRootLogger()` retrieves whichever of the two set it up. In tests, pass `destination` to a writable you control instead of asserting against stdout — see [Testing](../../guides/testing/).

| Option | Default | Meaning |
|---|---|---|
| `level` | `LOG_LEVEL`, then `"info"` | Minimum level. An unknown level throws at startup. |
| `pretty` | on outside production when stdout is a TTY | Human-readable output through `pino-pretty`; otherwise one JSON object per line. |
| `redact` | see below | Paths whose values are replaced by `[Redacted]`. |
| `base`, `name` | none | Static fields on every line. |
| `destination` | stdout | A writable for tests. |

The default redaction covers `authorization`, `cookie`, `set-cookie`, `password` and `token`, both at the top level of a log line and one level down (so `headers.cookie` and `user.password` are covered).

## `log` resolves at call time

The exported `log` is a proxy. Inside a request it is `ctx.log`; inside `runWithCtx` it is that context's logger; elsewhere it is the root. The same import therefore works in handlers, services, event listeners and scripts, and lines written from deep inside a service still carry the request id.

`ctx.log` is a child of the root carrying `requestId`, the matched `route` once the router picks one, and anything added with `ctx.bind(fields)`.

## Framework log lines

- One `info` line per request, written when the response finishes: `method`, `path`, `route`, `status`, `duration` in milliseconds, plus the request id and bound fields. `aborted: true` is added when the client went away first. `createApp` excludes `/health` and `/ready`; on bare Express use `context({ requestLog: { ignore } })` or `requestLog: false`.
- One `error` line per 5xx from the error handler, with the full error, status, code and route.
- Listen and shutdown lines from `createApp` (`logger: { startup: false }` disables them).

## Ambient context

The request context is made ambient with `AsyncLocalStorage`, so code that has no `ctx` parameter can still reach it:

```ts
import { currentCtx, requireCtx } from "notio";

export async function audit(action: string) {
  const ctx = currentCtx();          // Ctx | undefined
  await db.audit.insert({ action, requestId: ctx?.requestId, userId: ctx?.user?.id });
}

export function mustBeInRequest() {
  return requireCtx();               // throws Internal outside a request
}
```

`createApp` enters the store in its first middleware. On a bare Express app, [`context()`](../../getting-started/existing-express/) does the same; a `Router` also enters it for its own chains, so handlers and route middleware always see it.

### Jobs and CLI

`runWithCtx` gives non-HTTP work its own context, with a `kind`, a request id and a child logger, so `log` and `currentBaseCtx()` behave the same way there:

```ts
await runWithCtx({ kind: "job", state: { jobName: "nightly-sync" } }, async (ctx) => {
  ctx.bind({ jobName: "nightly-sync" });
  log.info("starting");            // carries requestId, kind and jobName
  await sync();
});
```

`currentCtx()` returns only HTTP contexts. `currentBaseCtx()` returns whatever context is active, HTTP or not; narrow with `kind`.
