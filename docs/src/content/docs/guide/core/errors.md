---
title: Errors
---

Throw errors; never call `next(err)`. The router forwards anything thrown by middleware or handlers to Express's error path, where notio's error handler renders one wire shape:

```json
{ "code": "NOT_FOUND", "message": "Order 42 does not exist", "details": { "id": 42 }, "requestId": "…" }
```

`details` is present only when the error carries some. The error's class name is never included.

## The HttpError family

```ts
import { NotFound, Conflict, HttpError, defineError } from "@jetframez/notio";

throw new NotFound();                                   // 404 NOT_FOUND "Not Found"
throw new NotFound("Order 42 does not exist", { id: 42 });
throw new HttpError(418, "TEAPOT");                      // any status and code
class QuotaExceeded extends defineError(402, "QUOTA_EXCEEDED") {}
```

| Class | Status | Code |
|---|---|---|
| `BadRequest` | 400 | `BAD_REQUEST` |
| `Unauthorized` | 401 | `UNAUTHORIZED` |
| `Forbidden` | 403 | `FORBIDDEN` |
| `NotFound` | 404 | `NOT_FOUND` |
| `MethodNotAllowed` | 405 | `METHOD_NOT_ALLOWED` |
| `Conflict` | 409 | `CONFLICT` |
| `Gone` | 410 | `GONE` |
| `PayloadTooLarge` | 413 | `PAYLOAD_TOO_LARGE` |
| `Unprocessable` | 422 | `VALIDATION` |
| `TooManyRequests` | 429 | `RATE_LIMITED` |
| `Internal` | 500 | `INTERNAL` |
| `ServiceUnavailable` | 503 | `SERVICE_UNAVAILABLE` |

Every constructor takes `(message?, details?)`; the default message is the HTTP status text. `isHttpError(err)` narrows an unknown catch value to the `HttpError` type. A full list of the codes notio itself emits, across every module, is in the [error code reference](/reference/error-codes).

## The error handler

`createApp` registers the handler for you and `app.errors({ map, format, expose })` configures it. On a bare Express app, register it yourself last, after a 404 handler — see [Using notio in an existing Express app](/guide/getting-started/existing-express#error-handling).

### Classification

Errors are matched in this order:

1. **`map(err, ctx)`**, if configured. Return a `{ status, code, message, details? }` object or an `HttpError` to decide the response, or `undefined` to fall through. Use it to translate library errors (database constraint violations, upstream client errors) into your own codes — `classifyError` is the function running this whole list, exported if you need the same classification outside the handler. If `map` itself throws, that error is rendered as a 500.

   :::tip
   `map` sees every thrown error first, including your own `HttpError` instances — it is the seam for a specific library's errors (a Postgres unique-violation code, a Stripe API error), not a place to reimplement `HttpError` handling. Return `undefined` for anything you do not want to translate, and it falls through to the ordinary classification below.
   :::

2. **`HttpError`** → its status, code, message and details.
3. **Schema errors** thrown directly by a validation library (an error with an `issues` array, as Zod and Valibot throw from `parse`) → 422 `VALIDATION` with the issues in `details`.
4. **body-parser errors** → 400 `BAD_REQUEST` "Malformed request body", or 413 `PAYLOAD_TOO_LARGE` with the limit and length in `details`.
5. **Anything with a numeric `status` or `statusCode`** between 400 and 599 (the `http-errors` convention used across the Express ecosystem) → that status. The code is derived from the status text (`NOT_FOUND`, `IM_A_TEAPOT`). The error's message is used only when `err.expose` is true, as those libraries intend.
6. **Everything else** → 500 `INTERNAL`. With `expose: true` the body carries the real message and the stack; with `expose: false` the message is "Internal Server Error". The full error is always logged at `error` level, with the request id and route.

### `format`

`format(mapped, ctx)` replaces the envelope. It receives the classified `{ status, code, message, details? }` and the context, and returns the body. The status is applied regardless.

```ts
errorHandler({
  format: (mapped, ctx) => ({ error: { code: mapped.code, message: mapped.message }, traceId: ctx.requestId }),
});
```

The handler has no side-effect option. Alerting, metrics and audit logging go through `onError` hooks, which run exactly once per error.

### When headers were already sent

If the response was already partially written when the error occurred, the handler hands the error back to Express, which closes the connection. Nothing else can be done at that point.
