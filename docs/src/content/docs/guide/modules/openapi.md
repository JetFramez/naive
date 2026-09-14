---
title: OpenAPI
---

`@jetframez/naive/openapi` walks `routes()` into an OpenAPI 3.1 document and serves it with a Scalar UI. No code generation — this module only produces the spec.

```ts
import { openapi } from "@jetframez/naive/openapi";

const spec = openapi({
  info: { title: "Shop API", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  security: { session: { type: "apiKey", in: "cookie", name: "sid" } },
}).from(app);

app.use(spec.docs("/docs")); // UI at /docs, spec at /docs/openapi.json
```

`.from()` accepts an `App`, one or more `Router`s, or a mix — anything with `.routes()`.

## What gets documented

Every route not marked `.hidden()` becomes one OpenAPI operation, built entirely from what the router already knows:

- **Path, query and header parameters** from `.params()`, `.query()`, `.headers()`. A path parameter without a schema is documented as a required string. Query and header parameters are only listed when a schema declares them — there's no way to know their shape otherwise.
- **Request body**: `.body()` becomes `application/json`. A route with `.uploads()` becomes `multipart/form-data` instead, merging its upload fields (as `{ type: "string", format: "binary" }`, or an array when `maxCount` is set, with size/type/count constraints noted in `description`) alongside any `.body()` schema's properties, since a multipart form's text fields validate through `.body()` too.
- **Responses**: every `.response()` entry (both the main one and `.response(status, schema)` extras), plus one entry per class passed to `.errors()`, rendered with the unified `{ code, message, details?, requestId }` error body. A `422` is added automatically for any route with an input or upload schema; `401` and `403` are added automatically for a route secured by `auth.require()`. A route with nothing to document at all falls back to a bare `200`.
- **`summary`, `tags`, `deprecated`** pass straight through from the route builder.

## Schema conversion

Any Standard Schema works, dispatched by its `~standard.vendor`:

| Vendor | How |
|---|---|
| Zod | `zod`'s own `z.toJSONSchema()` (Zod 4+) |
| Valibot | the `@valibot/to-json-schema` package |
| ArkType | the schema's native `.toJsonSchema()` method |

Both are optional dependencies, imported lazily; using a schema from a library you haven't installed throws a message naming the install command. Register a converter for anything else:

```ts
openapi({ info, schemaConverters: { myLib: (schema) => ({ type: "object" /* ... */ }) } });
```

### Named schemas are hoisted; unnamed ones are inlined

A schema with a title is hoisted into `components.schemas` and referenced by `$ref` everywhere it's used; a schema without one is inlined at each use site, however many times it's reused. How you name one depends on the library:

```ts
z.object({ id: z.string() }).meta({ id: "Order", title: "Order" });   // Zod
v.pipe(v.object({ id: v.string() }), v.title("Order"));                // Valibot
type({ id: "string" }).configure({ title: "Order" });                  // ArkType
```

Two different schemas can't share a title — building the document throws, naming the collision.

## Security

`auth.require()` marks the middleware it returns with a well-known symbol; the OpenAPI module reads that symbol directly rather than depending on the auth package, so a route secured by anything else — a hand-rolled check, a third-party middleware — is invisible, exactly as if it carried no auth at all.

```ts
const auth = createAuth({ strategies: { session: cookieSession(), bearer: jwt({ secret }) }, default: "session" });

router.get("/orders").use(auth.require("session", "bearer")).handle(...);
```

Give `openapi({ security })` a scheme for each strategy name you want documented, keyed to match:

```ts
openapi({
  info,
  security: {
    session: { type: "apiKey", in: "cookie", name: "sid" },
    bearer: { type: "http", scheme: "bearer" },
  },
});
```

Only strategy names present in `security` are referenced on an operation; an `auth.require()` call naming a strategy you didn't add a scheme for still gets its `401`/`403` responses, just no `security` entry pointing at a scheme that doesn't exist.

## `wrapResponse`

For an app that wraps every JSON response in an envelope the router itself doesn't know about:

```ts
openapi({
  info,
  wrapResponse: (schema) => ({ type: "object", properties: { data: schema }, required: ["data"] }),
});
```

Applied to every schema built from `.response()`, documentation only — it has no effect on what actually gets sent.

## Limitations

- OpenAPI has no concept of an optional path segment. A route declared with `{...}` groups (`/users{/:id}`) is documented with the parameter always present, since there's no way to express "this segment might not be here" in the spec.
- Query and header parameters are only documented when a schema declares their shape; an undeclared `.query()`/`.headers()` means nothing to list.
- No code generation. `spec.document` is a plain JSON-serializable object — a CLI export or a generated client is out of scope; see [What naive does not do](../../about/scope/).
