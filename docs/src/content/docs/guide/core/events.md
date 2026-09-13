---
title: Events
---

An in-process, typed event bus. Listeners run under the emitter's request context, so `log` and `currentCtx()` inside a listener still refer to the request that emitted.

```ts
import { createEvents } from "@jetframez/notio";

export type Events = {
  "order.placed": { orderId: string };
  "order.cancelled": { orderId: string; reason: string };
  "stock.low": { sku: string };
};

export const events = createEvents<Events>();

events.on("order.placed", async (payload, meta) => {
  await mailer.confirm(payload.orderId);        // meta: { name, id, emittedAt }
});
events.on("order.*", (payload) => { /* union of order.* payloads */ });
events.once("stock.low", restock);
```

Without the generic the bus is untyped. Instead of types, the map may hold schemas; payloads are then validated on emit outside production and the payload type is inferred from the schema:

```ts
export const events = createEvents({ "order.placed": z.object({ orderId: z.string() }) });
```

## Emitting

- `emit(name, payload)` schedules every listener and resolves immediately. Listener errors are isolated: each is logged and delivered to `onError` handlers, and other listeners still run.
- `emitAndWait(name, payload)` runs every listener and waits. It rejects with the listener's error, or an `AggregateError` when several threw.

```ts
await events.emit("order.placed", { orderId });                 // fire and forget
await events.emitAndWait("order.placed", { orderId });          // in the request, before responding
events.onError(({ name, id, error }) => reporter.capture(error, { event: name, id }));
```

## Subscribing

`on` and `once` return an unsubscribe function; `off(name, listener)` removes by reference, including listeners registered with `once`. Patterns use `*` to match any characters, so `"order.*"` matches `order.placed` and `"*"` matches everything.

There is no outbox, queue or persistence; events are lost if the process dies before listeners run. Use `emitAndWait` when the side effect must complete before the response — see [What notio does not do](/guide/about/scope) for the reasoning.
