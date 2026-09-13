import { createApp, NotFound, Router } from "@jetframez/notio";
import { z } from "zod";

interface Order {
  id: string;
  total: number;
}

// In-memory "database" — the point of this example is the framework, not persistence.
const orders = new Map<string, Order>([["1", { id: "1", total: 42 }]]);

const router = new Router("/orders");

// #region get-route
router.get("/:id").handle((ctx) => {
  const order = orders.get(ctx.params.id);
  if (!order) throw new NotFound(`Order ${ctx.params.id} does not exist`, { id: ctx.params.id });
  return order;
});
// #endregion get-route

// #region post-route
router
  .post("/")
  .body(z.object({ total: z.number().positive() }))
  .handle((ctx) => {
    const order: Order = { id: String(orders.size + 1), total: ctx.body.total };
    orders.set(order.id, order);
    return order; // POST -> 201, per the response conventions
  });
// #endregion post-route

// #region wiring
const app = createApp({ logger: { level: "info" } });
app.mount(router);

const port = Number(process.env.PORT ?? 3000);
await app.listen(port, () => {
  console.log(`minimal example listening on http://localhost:${port}`);
  console.log(`  GET  /orders/1`);
  console.log(`  POST /orders   { "total": 10 }`);
});
// #endregion wiring
