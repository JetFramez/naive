---
title: Route builder
---

The chain returned by `new Router(prefix)` and by `router.get(path)` and friends. Full explanation of each is in [Router](/guide/core/router) and [Middleware](/guide/core/middleware); this page is the flat method list.

## On the router itself

| Method | Signature | Notes |
|---|---|---|
| `new Router(prefix?, options?)` | `(prefix?: string, options?: { validateResponses?: boolean }) => Router` | `validateResponses` defaults to `true` — see [Router: response validation](/guide/core/router#schemas-query-body-headers-response) |
| `.get` `.post` `.put` `.patch` `.delete` `.head` `.options` | `(path: string) => RouteBuilder` | One per HTTP method; `.body()` is unavailable on the chain returned by `get`, `delete`, `head`, `options` |
| `.use(...middleware)` | `(...middleware) => Router` | Router-level; applies to everything registered after it — keep the return value to keep narrowing |
| `.group(prefix, middleware?, fn)` | `(prefix: string, middlewareOrFn, fn?) => Router` | A sub-router sharing this router's prefix and middleware, extended with its own |
| `.mount(path, router)` | `(path: string, router: Router) => Router` | Attach another router under a path, copying middleware at mount time |
| `.static(path, dir, options?)` | `(path: string, dir: string, options?: StaticOptions) => Router` | Serves files; `{ spa: true }` falls back to `index.html` |
| `.redirect(from, to, status?)` | `(from: string, to: string, status?: number) => Router` | Default status `302` |
| `.onRequest(fn)` / `.onResponse(fn)` / `.onError(fn)` | see [Hooks](/guide/core/hooks) | Router-level observers |
| `.routes()` | `() => RouteInfo[]` | Every route beneath this router, including groups and mounts |
| `.statics()` / `.redirects()` | `() => StaticInfo[]` / `() => RedirectInfo[]` | The rest of what `.routes()` doesn't cover |
| `.express()` | `() => express.Router` | The compiled plain Express router |

## On a route (`router.get(path)` and so on)

| Method | Signature | Notes |
|---|---|---|
| `.params(schema)` | `(schema: StandardSchemaV1) => RouteBuilder` | Must declare exactly the path's parameters — a compile error otherwise |
| `.query(schema)` | `(schema: StandardSchemaV1) => RouteBuilder` | Values arrive as strings; a single value is promoted to an array when the schema wants one |
| `.headers(schema)` | `(schema: StandardSchemaV1) => RouteBuilder` | Header names are lower-case |
| `.body(schema)` | `(schema: StandardSchemaV1) => RouteBuilder` | Not offered on `GET`, `DELETE`, `HEAD`, `OPTIONS` |
| `.uploads(spec)` | `(spec: UploadFieldsSpec) => RouteBuilder` | Requires the [upload module](/guide/modules/upload) installed on the app |
| `.use(...middleware)` | `(...middleware) => RouteBuilder` | Route-level; runs after validation, before the handler |
| `.summary(text)` | `(text: string) => RouteBuilder` | Documentation only, read by the [OpenAPI module](/guide/modules/openapi) |
| `.tags(...tags)` | `(...tags: string[]) => RouteBuilder` | Documentation only |
| `.response(schema)` | `(schema: StandardSchemaV1) => RouteBuilder` | Constrains the handler's return type; validated outside production |
| `.response(status, schema)` | `(status: number, schema: StandardSchemaV1) => RouteBuilder` | Documents an additional response; metadata only, no runtime check |
| `.errors(...classes)` | `(...classes: HttpErrorClass[]) => RouteBuilder` | Documents which `HttpError` subclasses this route may throw |
| `.deprecated()` | `() => RouteBuilder` | Marks the operation deprecated in the generated OpenAPI spec |
| `.hidden()` | `() => RouteBuilder` | Excludes the route from `.routes()` consumers, including OpenAPI |
| `.handle(handler)` | `(handler: Handler) => RouteInfo` | Registers the route; must be called last |

Every method except `.handle()` returns the same builder (narrowed further by TypeScript where the method adds a type), so the chain can continue in any order except that `.handle()` ends it and `.body()` is unavailable on the methods listed above.
