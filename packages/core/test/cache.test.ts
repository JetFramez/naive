import { describe, expect, it, vi } from "vitest";
import { createCache, redisStore } from "../src/index.js";

const tick = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe("createCache", () => {
  it("get/set/has/delete/clear with TTL as duration strings", async () => {
    const cache = createCache({ prefix: "t" });
    await cache.set("a", { n: 1 });
    await cache.set("b", "short", { ttl: "20ms" });
    expect(await cache.get<{ n: number }>("a")).toEqual({ n: 1 });
    expect(await cache.has("b")).toBe(true);
    await tick(30);
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.delete("a")).toBe(true);
    expect(await cache.has("a")).toBe(false);
    await cache.set("c", 1);
    await cache.clear();
    expect(await cache.get("c")).toBeUndefined();
    await cache.close();
  });

  it("applies a default ttl", async () => {
    const cache = createCache({ ttl: 20 });
    await cache.set("x", 1);
    expect(await cache.get("x")).toBe(1);
    await tick(30);
    expect(await cache.get("x")).toBeUndefined();
  });

  it("remember computes once and shares in-flight computations", async () => {
    const cache = createCache();
    const compute = vi.fn(async () => {
      await tick(20);
      return "value";
    });
    const results = await Promise.all([
      cache.remember("k", "1m", compute),
      cache.remember("k", "1m", compute),
      cache.remember("k", "1m", compute),
    ]);
    expect(results).toEqual(["value", "value", "value"]);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(await cache.remember("k", "1m", compute)).toBe("value");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("remember does not cache failures and releases the in-flight slot", async () => {
    const cache = createCache();
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw new Error("first fails");
      return "ok";
    };
    await expect(cache.remember("f", undefined, flaky)).rejects.toThrow("first fails");
    expect(await cache.remember("f", undefined, flaky)).toBe("ok");
  });

  it("tags associate entries and flush removes them", async () => {
    const cache = createCache();
    const orders = cache.tags("orders");
    const mixed = cache.tags("orders", "user:1");
    await orders.set("order:1", "a");
    await mixed.remember("user:1:orders", "1m", async () => ["a"]);
    await cache.set("untagged", "keep");
    expect(await cache.get("order:1")).toBe("a");
    await cache.tags("user:1").flush();
    expect(await cache.get("user:1:orders")).toBeUndefined();
    expect(await cache.get("order:1")).toBe("a");
    await orders.flush();
    expect(await cache.get("order:1")).toBeUndefined();
    expect(await cache.get("untagged")).toBe("keep");
    await orders.set("order:2", "b");
    expect(await cache.get("order:2")).toBe("b");
  });

  it("registers close() on the app's shutdown when given one", () => {
    const hooks: Array<() => unknown> = [];
    const cache = createCache({ app: { onShutdown: (fn) => hooks.push(fn) } });
    expect(hooks).toHaveLength(1);
    expect(cache.keyv).toBeDefined();
  });

  it("redisStore explains when the optional package is missing", async () => {
    vi.doMock("@keyv/redis", () => {
      throw new Error("Cannot find module");
    });
    await expect(redisStore("redis://localhost")).rejects.toThrow(/pnpm add @keyv\/redis/);
    vi.doUnmock("@keyv/redis");
  });
});
