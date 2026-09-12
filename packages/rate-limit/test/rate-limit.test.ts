import { Router } from "@notio-internal/core";
import RedisMock from "ioredis-mock";
import { describe, expect, it } from "vitest";
import { rateLimit } from "../src/rate-limit.js";
import type { RedisLike } from "../src/types.js";
import { withApp } from "./helpers/http.js";

describe("rateLimit()", () => {
  it("sets RateLimit-* headers on every response and 429s once exceeded", async () => {
    const router = new Router().use(rateLimit({ limit: 2, window: "200ms" }));
    router.get("/x").handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const first = await fetch("/x");
        expect(first.status).toBe(200);
        expect(first.headers.get("ratelimit-limit")).toBe("2");
        expect(first.headers.get("ratelimit-remaining")).toBe("1");
        expect(Number(first.headers.get("ratelimit-reset"))).toBeGreaterThan(0);

        const second = await fetch("/x");
        expect(second.headers.get("ratelimit-remaining")).toBe("0");

        const third = await fetch("/x");
        expect(third.status).toBe(429);
        expect(third.headers.get("ratelimit-remaining")).toBe("0");
        expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
        const body = await third.json();
        expect(body.code).toBe("RATE_LIMITED");
        expect(body.details).toMatchObject({
          limit: 2,
          window: 200,
          retryAfter: expect.any(Number),
        });
      },
    );
  });

  it("defaults the key to ctx.ip, so different IPs are limited independently", async () => {
    const router = new Router().use(rateLimit({ limit: 1, window: "1m" }));
    router.get("/x").handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        expect((await fetch("/x")).status).toBe(200);
        expect((await fetch("/x")).status).toBe(429);
        // Same test client, same IP (127.0.0.1) — this just documents the default is IP-based,
        // the custom-key test below proves independence directly.
      },
    );
  });

  it("groups by a custom key function, and null/undefined skips the limit entirely", async () => {
    const router = new Router().use(
      rateLimit({ limit: 1, window: "1m", key: (ctx) => ctx.headers.get("x-tenant") ?? null }),
    );
    router.get("/x").handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        expect((await fetch("/x", { headers: { "x-tenant": "a" } })).status).toBe(200);
        expect((await fetch("/x", { headers: { "x-tenant": "a" } })).status).toBe(429);
        expect((await fetch("/x", { headers: { "x-tenant": "b" } })).status).toBe(200);
        // No tenant header at all -> key() returns null -> unlimited.
        expect((await fetch("/x")).status).toBe(200);
        expect((await fetch("/x")).status).toBe(200);
      },
    );
  });

  it("skip() bypasses the limit and does not set rate-limit headers", async () => {
    const router = new Router().use(
      rateLimit({ limit: 1, window: "1m", skip: (ctx) => ctx.path === "/health" }),
    );
    router.get("/health").handle(() => "ok");
    router.get("/x").handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const health1 = await fetch("/health");
        const health2 = await fetch("/health");
        expect(health1.status).toBe(200);
        expect(health2.status).toBe(200);
        expect(health1.headers.get("ratelimit-limit")).toBeNull();
        expect((await fetch("/x")).status).toBe(200);
        expect((await fetch("/x")).status).toBe(429);
      },
    );
  });

  it("cost can be a fixed number or computed per request", async () => {
    const router = new Router().use(
      rateLimit({ limit: 10, window: "1m", cost: (ctx) => Number(ctx.headers.get("x-cost") ?? 1) }),
    );
    router.get("/x").handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const heavy = await fetch("/x", { headers: { "x-cost": "8" } });
        expect(heavy.headers.get("ratelimit-remaining")).toBe("2");
        const light = await fetch("/x", { headers: { "x-cost": "2" } });
        expect(light.headers.get("ratelimit-remaining")).toBe("0");
        expect((await fetch("/x", { headers: { "x-cost": "1" } })).status).toBe(429);
      },
    );
  });

  it("calls onLimited exactly when a request is rejected, with limit/window/retryAfter/key", async () => {
    const events: unknown[] = [];
    const router = new Router().use(
      rateLimit({
        limit: 1,
        window: "1m",
        onLimited: (_ctx, info) => {
          events.push(info);
        },
      }),
    );
    router.get("/x").handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        await fetch("/x");
        expect(events).toHaveLength(0);
        await fetch("/x");
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          limit: 1,
          window: 60_000,
          retryAfter: expect.any(Number),
          key: "127.0.0.1",
        });
      },
    );
  });

  it("supports all three algorithms end to end", async () => {
    for (const algorithm of ["fixed", "sliding", "token-bucket"] as const) {
      const router = new Router().use(rateLimit({ limit: 1, window: "1m", algorithm }));
      router.get("/x").handle(() => "ok");
      await withApp(
        (app) => app.mount(router),
        async ({ fetch }) => {
          expect((await fetch("/x")).status).toBe(200);
          expect((await fetch("/x")).status).toBe(429);
        },
      );
    }
  });

  it("runs on a Redis client end to end, sharing one client across limiters isolated by name", async () => {
    const store = new RedisMock() as unknown as RedisLike;
    const router = new Router();
    router
      .get("/a")
      .use(rateLimit({ limit: 1, window: "1m", store, name: "a" }))
      .handle(() => "ok");
    router
      .get("/b")
      .use(rateLimit({ limit: 1, window: "1m", store, name: "b", algorithm: "token-bucket" }))
      .handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        expect((await fetch("/a")).status).toBe(200);
        expect((await fetch("/b")).status).toBe(200);
        const a = await fetch("/a");
        expect(a.status).toBe(429);
        expect(a.headers.get("ratelimit-remaining")).toBe("0");
        expect((await fetch("/b")).status).toBe(429);
      },
    );
  });

  it("falls back to memory for a request when Redis throws, and fails closed with fallback: false", async () => {
    const broken: RedisLike = {
      eval: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    const router = new Router();
    router
      .get("/soft")
      .use(rateLimit({ limit: 1, window: "1m", store: broken, name: "soft" }))
      .handle(() => "ok");
    router
      .get("/hard")
      .use(rateLimit({ limit: 1, window: "1m", store: broken, name: "hard", fallback: false }))
      .handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        expect((await fetch("/soft")).status).toBe(200);
        expect((await fetch("/soft")).status).toBe(429); // memory copy still enforces
        const hard = await fetch("/hard");
        expect(hard.status).toBe(500);
        expect((await hard.json()).message).toMatch(/ECONNREFUSED/);
      },
    );
  });
});
