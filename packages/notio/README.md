# notio

A TypeScript web framework on Express 5. Express stays the transport — `app.express` is always the real instance, and any `(req, res, next)` middleware from the ecosystem works unchanged. On top of it, notio adds a typed, chainable router, a per-request context, one error shape, hooks, logging, config, and optional modules for auth, uploads, rate limiting and OpenAPI.

Full documentation: **<https://jetframez.github.io/notio/>**

## Install

```sh
pnpm add notio zod
```

Node 22 or later, ESM. Express ships inside the package. Zod is one choice of schema library — Valibot and ArkType work the same way through [Standard Schema](https://standardschema.dev), and notio depends on none of them.

## A first route

```ts
import { createApp, NotFound, Router } from "notio";
import { z } from "zod";

const orders = new Router("/orders");

orders.get("/:id").handle((ctx) => {
  const order = db.get(ctx.params.id); // ctx.params.id: string, inferred from ":id"
  if (!order) throw new NotFound(`Order ${ctx.params.id} does not exist`);
  return order; // -> 200 JSON
});

orders
  .post("/")
  .body(z.object({ total: z.number().positive() }))
  .handle((ctx) => db.create(ctx.body)); // ctx.body.total: number, validated -> 201 JSON

const app = createApp();
app.mount(orders);
await app.listen(3000);
```

Every thrown error and every failed validation renders through the same shape:

```json
{ "code": "VALIDATION", "message": "Invalid body", "details": { "in": "body", "issues": [] }, "requestId": "…" }
```

## Optional modules

Each lives at its own subpath and does nothing until you import and call it:

| Import | Adds |
|---|---|
| `notio/auth` | sessions, JWTs, opaque tokens with rotation, password hashing |
| `notio/upload` | multipart file uploads with content-sniffed type detection |
| `notio/rate-limit` | fixed window, sliding window, token bucket — memory or Redis |
| `notio/openapi` | OpenAPI 3.1 generation with a Scalar docs UI |

## License

MIT © JetFramez
