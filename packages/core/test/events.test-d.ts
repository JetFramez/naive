import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createEvents, type EventMeta } from "../src/index.js";

type Events = {
  "order.placed": { orderId: string };
  "order.cancelled": { orderId: string; reason: string };
  "stock.low": { sku: string };
};

describe("events types", () => {
  it("types payloads by name and by wildcard", () => {
    const events = createEvents<Events>();
    events.on("order.placed", (p, meta) => {
      expectTypeOf(p).toEqualTypeOf<{ orderId: string }>();
      expectTypeOf(meta).toEqualTypeOf<EventMeta>();
    });
    events.on("order.*", (p) => {
      expectTypeOf(p).toEqualTypeOf<{ orderId: string } | { orderId: string; reason: string }>();
    });
    events.on("*", (p) => {
      expectTypeOf(p).toEqualTypeOf<
        { orderId: string } | { orderId: string; reason: string } | { sku: string }
      >();
    });
    void events.emit("stock.low", { sku: "s" });
    // @ts-expect-error wrong payload
    void events.emit("stock.low", { orderId: "s" });
    // @ts-expect-error unknown event
    void events.emit("nope", {});
  });

  it("infers payloads from schemas", () => {
    const events = createEvents({
      "order.placed": z.object({ orderId: z.string(), total: z.number() }),
    });
    events.on("order.placed", (p) => {
      expectTypeOf(p).toEqualTypeOf<{ orderId: string; total: number }>();
    });
  });

  it("is untyped without a generic", () => {
    const events = createEvents();
    void events.emit("anything", { free: true });
    events.on("x.*", (p) => {
      expectTypeOf(p).toEqualTypeOf<unknown>();
    });
  });
});
