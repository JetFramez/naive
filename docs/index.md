---
layout: home
hero:
  name: notio
  text: A TypeScript web framework on Express 5
  tagline: Keep Express as the transport and get a typed router, a per-request context, unified errors, and optional modules for auth, uploads, rate limiting, and OpenAPI — all fully typed, none of it hidden behind magic.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started/installation
    - theme: alt
      text: Examples
      link: /examples
features:
  - title: Express is the transport
    details: app.express is always the real Express instance. Any (req, res, next) middleware from the ecosystem works unchanged.
    link: /guide/getting-started/existing-express
    linkText: Adopt it incrementally
  - title: Typed end to end
    details: Path params inferred from the route string, Standard Schema validation for query/body/headers, Middleware<Adds> narrowing across the chain.
    link: /guide/core/router
    linkText: Read the Router guide
  - title: Nothing implicit at boot
    details: Modules are constructed by you and passed where needed. Missing config or adapter methods fail at startup, listed together.
    link: /guide/core/config
    linkText: Read the Config guide
  - title: One error shape everywhere
    details: Throw an HttpError, a validation failure, or a plain Error — every one renders as the same { code, message, details, requestId } envelope.
    link: /guide/core/errors
    linkText: Read the Errors guide
  - title: Bring your own schema library
    details: Zod, Valibot, and ArkType all work through Standard Schema. notio depends on none of them.
    link: /guide/getting-started/installation
    linkText: See installation
  - title: Optional modules, not a plugin system
    details: Auth, uploads, rate limiting, and OpenAPI live at their own subpaths. Import what you use; nothing registers itself.
    link: /guide/modules/auth
    linkText: Browse the modules
---

## A first route

```ts
import { createApp, NotFound, Router } from "@jetframez/notio";
import { z } from "zod";

const orders = new Router("/orders");

orders.get("/:id").handle((ctx) => {
  const order = db.orders.get(ctx.params.id); //   ctx.params.id: string, inferred from ":id"
  if (!order) throw new NotFound(`Order ${ctx.params.id} does not exist`);
  return order; // -> 200 JSON
});

orders
  .post("/")
  .body(z.object({ total: z.number().positive() }))
  .handle((ctx) => db.orders.create({ total: ctx.body.total })); //   ctx.body.total: number, validated
  // -> 201 JSON

const app = createApp();
app.mount(orders);
await app.listen(3000);
```

Every thrown error and every validation failure renders through the same shape:

```json
{ "code": "VALIDATION", "message": "Invalid body", "details": { "in": "body", "issues": [] }, "requestId": "…" }
```

Continue with [Your first app](/guide/getting-started/first-app) for the full walkthrough.
