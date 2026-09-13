# Error codes

Every error notio's error handler renders carries a `status` and a `code` in the unified envelope — see [Errors](/guide/core/errors). This page lists every code notio itself can produce, across the core and every module. A code your own application throws (via `defineError` or `map`) is not listed here; it is whatever you named it.

## From the `HttpError` family

Thrown directly by your code, or by notio internals using the same classes.

| Code | Status | Thrown by |
|---|---|---|
| `BAD_REQUEST` | 400 | `new BadRequest()`, or a malformed request body from the body parser |
| `UNAUTHORIZED` | 401 | `new Unauthorized()`; `auth.require()` when no strategy matched; `auth.verifyPassword()` on a mismatch; an expired or reused refresh token |
| `FORBIDDEN` | 403 | `new Forbidden()`; `auth.csrf()` on a missing or invalid CSRF token |
| `NOT_FOUND` | 404 | `new NotFound()`; the router's own 404 handler |
| `METHOD_NOT_ALLOWED` | 405 | `new MethodNotAllowed()` |
| `CONFLICT` | 409 | `new Conflict()` |
| `GONE` | 410 | `new Gone()` |
| `PAYLOAD_TOO_LARGE` | 413 | `new PayloadTooLarge()`, or a body over the configured JSON/urlencoded limit |
| `VALIDATION` | 422 | `new Unprocessable()`; a failing `.params()`/`.query()`/`.headers()`/`.body()`/`.uploads()` schema |
| `RATE_LIMITED` | 429 | `new TooManyRequests()`; the rate-limit module once a limiter's `limit` is exceeded |
| `INTERNAL` | 500 | `new Internal()`; an uncaught non-`HttpError`; a middleware that neither called `next()`, threw, nor responded |
| `SERVICE_UNAVAILABLE` | 503 | `new ServiceUnavailable()` |

Any other status between 400 and 599 (from `HttpError(status, code)`, `defineError`, or a library throwing the `http-errors` convention) renders with the code you gave it, or one derived from the status text (`IM_A_TEAPOT` for 418, for example).

## Upload issue codes

A failing `.uploads()` field renders as `VALIDATION` (422) with `details.in` set to `"uploads"` and one issue per offending field in `details.issues`, each carrying one of these codes:

| Code | When |
|---|---|
| `FILE_TOO_LARGE` | A file exceeded its field's (or the global) `maxSize`. |
| `FILE_TYPE_NOT_ALLOWED` | The content-sniffed type did not match the field's `types`. |
| `TOO_MANY_FILES` | A field received more files than its `maxCount` (or more than one, without `maxCount`). |
| `FILE_REQUIRED` | A non-optional field had no file part at all. |
| `UNEXPECTED_FILE` | A file field was not declared in `.uploads()`. |
| `TOTAL_SIZE_EXCEEDED` | The request's combined file size exceeded `maxTotalSize`. Reported alone, not alongside other issues. |

See [Uploads](/guide/modules/upload#issues) for the full shape and for customising messages per code.

## Schema validation issues

For `.params()`, `.query()`, `.headers()` and `.body()`, the `VALIDATION` envelope's `details.issues` array is produced by the schema library itself (Zod, Valibot, ArkType) via its Standard Schema `issues` output — notio does not define its own vocabulary of validation issue codes here. `details.in` names which section failed: `"params"`, `"query"`, `"headers"`, or `"body"`.

## Not wire errors

`ConfigError` (from `defineConfig`) and the various "adapter is missing required methods" errors from `createAuth()` are thrown at startup, before any request is served — they never reach the error handler and carry no `code` in the wire sense. See [Config](/guide/core/config#errors-at-boot) and [Auth](/guide/modules/auth#the-adapter).
