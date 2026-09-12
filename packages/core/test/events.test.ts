import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createEvents, currentBaseCtx, runWithCtx } from "../src/index.js";

type Events = {
  "order.placed": { orderId: string };
  "order.cancelled": { orderId: string; reason: string };
  "stock.low": { sku: string };
};

const tick = () => new Promise((res) => setTimeout(res, 5));

describe("createEvents", () => {
  it("emit schedules listeners without waiting; emitAndWait waits", async () => {
    const events = createEvents<Events>();
    const seen: string[] = [];
    events.on("order.placed", async (p, meta) => {
      await tick();
      seen.push(`${p.orderId}:${meta.name}:${meta.id.length}:${meta.emittedAt instanceof Date}`);
    });
    await events.emit("order.placed", { orderId: "a" });
    expect(seen).toEqual([]);
    await tick();
    await tick();
    expect(seen).toEqual(["a:order.placed:36:true"]);
    await events.emitAndWait("order.placed", { orderId: "b" });
    expect(seen).toHaveLength(2);
  });

  it("supports wildcards, once and off", async () => {
    const events = createEvents<Events>();
    const all: string[] = [];
    const orders: string[] = [];
    events.on("*", (_p, meta) => {
      all.push(meta.name);
    });
    const offOrders = events.on("order.*", (p) => {
      orders.push(p.orderId);
    });
    let onceCount = 0;
    const onceFn = () => {
      onceCount++;
    };
    events.once("stock.low", onceFn);
    await events.emitAndWait("order.placed", { orderId: "1" });
    await events.emitAndWait("stock.low", { sku: "s" });
    await events.emitAndWait("stock.low", { sku: "s" });
    offOrders();
    await events.emitAndWait("order.cancelled", { orderId: "2", reason: "r" });
    expect(all).toEqual(["order.placed", "stock.low", "stock.low", "order.cancelled"]);
    expect(orders).toEqual(["1"]);
    expect(onceCount).toBe(1);

    const named = () => {
      all.push("named");
    };
    events.on("order.placed", named);
    events.off("order.placed", named);
    const onceNamed = () => {
      all.push("once-named");
    };
    events.once("order.placed", onceNamed);
    events.off("order.placed", onceNamed);
    await events.emitAndWait("order.placed", { orderId: "3" });
    expect(all.filter((n) => n.includes("named"))).toEqual([]);
  });

  it("isolates listener errors on emit and reports them to onError and the log", async () => {
    const events = createEvents<Events>();
    const okRan: string[] = [];
    const failures: string[] = [];
    events.on("order.placed", () => {
      throw new Error("listener a failed");
    });
    events.on("order.placed", (p) => {
      okRan.push(p.orderId);
    });
    events.onError((f) => {
      failures.push(`${f.name}:${(f.error as Error).message}:${typeof f.listener}`);
    });
    await events.emit("order.placed", { orderId: "x" });
    await tick();
    expect(okRan).toEqual(["x"]);
    expect(failures).toEqual(["order.placed:listener a failed:function"]);
  });

  it("emitAndWait rejects with the error, or an AggregateError when several threw", async () => {
    const events = createEvents<Events>();
    events.on("order.placed", () => {
      throw new Error("one");
    });
    await expect(events.emitAndWait("order.placed", { orderId: "x" })).rejects.toThrow("one");
    events.on("order.placed", async () => {
      throw new Error("two");
    });
    await expect(events.emitAndWait("order.placed", { orderId: "x" })).rejects.toBeInstanceOf(
      AggregateError,
    );
  });

  it("runs listeners under the emitter's context", async () => {
    const events = createEvents<Events>();
    let seenRequestId: string | undefined;
    events.on("order.placed", () => {
      seenRequestId = currentBaseCtx()?.requestId;
    });
    await runWithCtx({ requestId: "job-9" }, () =>
      events.emitAndWait("order.placed", { orderId: "1" }),
    );
    expect(seenRequestId).toBe("job-9");
    seenRequestId = "unset";
    await events.emitAndWait("order.placed", { orderId: "1" });
    expect(seenRequestId).toBeUndefined();
  });

  it("validates payloads against schemas outside production", async () => {
    const events = createEvents({
      "order.placed": z.object({ orderId: z.string(), total: z.coerce.number() }),
    });
    const seen: unknown[] = [];
    events.on("order.placed", (p) => {
      seen.push(p);
    });
    await events.emitAndWait("order.placed", { orderId: "1", total: "5" as never });
    expect(seen).toEqual([{ orderId: "1", total: 5 }]);
    await expect(events.emit("order.placed", { orderId: 1 as never, total: 2 })).rejects.toThrow(
      /Invalid payload for event "order.placed"/,
    );

    const unchecked = createEvents<{ "order.placed": { orderId: string } }>({
      schemas: { "order.placed": z.object({ orderId: z.string() }) },
      validate: false,
    });
    await expect(
      unchecked.emitAndWait("order.placed", { orderId: 1 as never }),
    ).resolves.toBeUndefined();
  });
});
