# Your first app

This walks through the `minimal` example in the repository, one piece at a time. The full file is runnable as-is; see [Examples](/examples) to run it.

## A router

A `Router` groups routes under a prefix. Nothing runs until you mount it on an app.

```ts
import { Router } from "@jetframez/notio";

const orders = new Router("/orders");
```

## A route with validation

`.body(schema)` accepts any Standard Schema value — a Zod object here. `.handle()` registers the route and gives you a typed `ctx`.

```ts
import { z } from "zod";

orders
  .post("/")
  .body(z.object({ total: z.number().positive() }))
  .handle((ctx) => {
    const order = { id: crypto.randomUUID(), total: ctx.body.total };
    //                                                 ^ typed as number, already validated
    return order; // a plain object from a POST handler becomes a 201 JSON response
  });
```

Nothing here mentions the response. Returning a plain value is enough; the router decides the status and content type from what you return, and from the HTTP method. See [Responses](/guide/core/responses).

## An error

Throw. Never call `next(err)`.

```ts
import { NotFound } from "@jetframez/notio";

orders.get("/:id").handle((ctx) => {
  const order = findOrder(ctx.params.id); //   ctx.params.id: string, inferred from ":id"
  if (!order) throw new NotFound(`Order ${ctx.params.id} does not exist`, { id: ctx.params.id });
  return order;
});
```

Every error notio's handler renders comes out the same shape:

```json
{ "code": "NOT_FOUND", "message": "Order 42 does not exist", "details": { "id": "42" }, "requestId": "…" }
```

## Wiring it together

`createApp` builds a real Express application with body parsing, a request context, and an error handler already registered in the right order. `app.mount()` attaches a router at its own prefix.

```ts
import { createApp } from "@jetframez/notio";

const app = createApp();
app.mount(orders);

await app.listen(3000);
```

## Running it

```sh
curl http://localhost:3000/orders/1
# 404 with the unified error shape, since nothing has been created yet

curl -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"total": 10}'
# 201 { "id": "...", "total": 10 }

curl -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"total": -5}'
# 422 { "code": "VALIDATION", "message": "Invalid body", "details": { "in": "body", "issues": [...] }, "requestId": "..." }
```

## What just happened

- The body was validated before the handler ran; a negative total never reached your code.
- `ctx.params.id` and `ctx.body.total` were typed, not cast.
- The thrown error and the validation failure rendered through the same envelope, with no error-handling code written by you.
- `app.express` is a real Express app the whole time — anything in the Express ecosystem still works if you drop down to it.

## Next

- [How a request flows](./request-flow) walks through what `createApp` and the router actually do, in order, for every request.
- [Router](/guide/core/router) covers path params, schemas, and typed narrowing in full.
- [Using notio in an existing Express app](./existing-express) if you are adding this to something that already exists.
