import type { AddressInfo } from "node:net";
import type { RequestHandler } from "express";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type App,
  createApp,
  Forbidden,
  type Middleware,
  NotFound,
  Router,
} from "../../src/index.js";
import { captureLogger } from "../helpers/logger.js";

async function start(app: App) {
  const server = await app.listen(0, "127.0.0.1");
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  return {
    fetch: (path: string, init?: RequestInit) =>
      fetch(`${base}${path}`, { redirect: "manual", ...init }),
    close: () => app.close(),
  };
}

const quiet = () => {
  const { logger, lines } = captureLogger();
  return { logger, lines, options: { logger, shutdown: { signals: false as const } } };
};

describe("createApp", () => {
  it("wires ctx, body parsing, routers, 404 and errors regardless of registration order", async () => {
    const { options } = quiet();
    const app = createApp(options);
    const r = new Router("/api");
    r.post("/echo")
      .body(z.object({ n: z.number() }))
      .handle((ctx) => ctx.body);
    r.get("/fail").handle(() => {
      throw new Forbidden("nope");
    });
    app.errors({ format: (m, ctx) => ({ e: m.code, rid: ctx.requestId }) });
    app.use(async (ctx, next) => {
      ctx.set("x-app", "1");
      await next();
    });
    app.mount(r);
    const s = await start(app);
    try {
      const echo = await s.fetch("/api/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"n":1}',
      });
      expect(echo.status).toBe(201);
      expect(await echo.json()).toEqual({ n: 1 });
      expect(echo.headers.get("x-app")).toBe("1");
      const fail = await s.fetch("/api/fail");
      expect(fail.status).toBe(403);
      expect(await fail.json()).toEqual({ e: "FORBIDDEN", rid: expect.any(String) });
      const missing = await s.fetch("/nope");
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ e: "NOT_FOUND", rid: expect.any(String) });
    } finally {
      await s.close();
    }
  });

  it("applies body options: json limit, json off, urlencoded on", async () => {
    const { options } = quiet();
    const app = createApp({
      ...options,
      body: { json: { limit: "32b" }, urlencoded: { limit: "1kb" } },
    });
    const r = new Router();
    r.post("/b").handle((ctx) => ctx.body ?? null);
    app.mount(r);
    const s = await start(app);
    try {
      const big = await s.fetch("/b", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ x: "y".repeat(100) }),
      });
      expect(big.status).toBe(413);
      const form = await s.fetch("/b", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "a=1&b[c]=2",
      });
      expect(await form.json()).toEqual({ a: "1", b: { c: "2" } });
    } finally {
      await s.close();
    }
    const noJson = createApp({ ...options, body: { json: false } });
    noJson.mount(r);
    const s2 = await start(noJson);
    try {
      const res = await s2.fetch("/b", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"n":1}',
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toBeNull();
    } finally {
      await s2.close();
    }
  });

  it("mounts under a prefix, serves statics and redirects, and aggregates routes()", async () => {
    const { options } = quiet();
    const app = createApp(options);
    const users = new Router("/users");
    users.get("/:id").handle((ctx) => ({ id: ctx.params.id, route: ctx.route }));
    const health = new Router();
    health.get("/ping").handle(() => "pong");
    app.mount("/api/v1", users, health);
    app.redirect("/old", "/new", 301);
    const s = await start(app);
    try {
      expect(await (await s.fetch("/api/v1/users/3")).json()).toEqual({
        id: "3",
        route: "GET /api/v1/users/:id",
      });
      expect(await (await s.fetch("/api/v1/ping")).text()).toBe("pong");
      const redirect = await s.fetch("/old");
      expect(redirect.status).toBe(301);
      expect(app.routes().map((r) => `${r.method} ${r.path}`)).toEqual([
        "GET /api/v1/users/:id",
        "GET /api/v1/ping",
      ]);
    } finally {
      await s.close();
    }
  });

  it("serves /health and /ready, excluded from the request log, and honours health: false", async () => {
    const { options, lines } = quiet();
    const app = createApp(options);
    let readyDuringStart: number | undefined;
    const r = new Router();
    r.get("/x").handle(() => "ok");
    app.mount(r);
    app.onReady(async () => {
      const { port } = (app.server?.address() ?? {}) as AddressInfo;
      readyDuringStart = (await fetch(`http://127.0.0.1:${port}/ready`)).status;
    });
    const s = await start(app);
    try {
      expect(readyDuringStart).toBe(503);
      expect(await (await s.fetch("/health")).json()).toEqual({ status: "ok" });
      expect(await (await s.fetch("/ready")).json()).toEqual({ status: "ready" });
      await s.fetch("/x");
      await new Promise((res) => setTimeout(res, 10));
      expect(lines.filter((l) => l.msg === "request").map((l) => l.path)).toEqual(["/x"]);
    } finally {
      await s.close();
    }
    const custom = createApp({ ...options, health: { path: "/live", ready: false } });
    const s2 = await start(custom);
    try {
      expect((await s2.fetch("/live")).status).toBe(200);
      expect((await s2.fetch("/ready")).status).toBe(404);
      expect((await s2.fetch("/health")).status).toBe(404);
    } finally {
      await s2.close();
    }
  });

  it("runs onStart before binding, onReady after, then the callback; onShutdown on close", async () => {
    const { options, lines } = quiet();
    const app = createApp(options);
    const events: string[] = [];
    app.onStart(async () => {
      await new Promise((res) => setTimeout(res, 5));
      events.push(`start:${app.server?.listening ?? false}`);
    });
    app.onReady(() => {
      events.push(`ready:${app.server?.listening}`);
    });
    app.onShutdown(async () => {
      events.push("shutdown");
    });
    app.onShutdown(() => {
      throw new Error("hook bug");
    });
    await app.listen(0, "127.0.0.1", () => events.push("callback"));
    expect(events).toEqual(["start:false", "ready:true", "callback"]);
    await app.close();
    await app.close();
    expect(events).toEqual(["start:false", "ready:true", "callback", "shutdown"]);
    expect(app.server?.listening).toBe(false);
    const msgs = lines.map((l) => l.msg);
    expect(msgs).toContain("shutting down");
    expect(msgs).toContain("closed");
    expect(msgs.some((m) => m?.startsWith("listening on port"))).toBe(true);
    expect(lines.find((l) => l.msg === "onShutdown hook threw")).toBeDefined();
  });

  it("drains in-flight requests and reports 503 on /ready while closing", async () => {
    const { options } = quiet();
    const app = createApp({ ...options, shutdown: { signals: false, deadline: "2s" } });
    const r = new Router();
    r.get("/slow").handle(async () => {
      await new Promise((res) => setTimeout(res, 150));
      return "done";
    });
    app.mount(r);
    const s = await start(app);
    const slow = s.fetch("/slow");
    await new Promise((res) => setTimeout(res, 20));
    const closing = app.close();
    const ready = await s.fetch("/ready").catch(() => undefined);
    expect(ready === undefined || ready.status === 503).toBe(true);
    expect(await (await slow).text()).toBe("done");
    await closing;
  });

  it("closes connections that outlive the shutdown deadline", async () => {
    const { options, lines } = quiet();
    const app = createApp({ ...options, shutdown: { signals: false, deadline: 50 } });
    const r = new Router();
    r.get("/hang").handle(() => new Promise<string>((res) => setTimeout(() => res("late"), 2000)));
    app.mount(r);
    const s = await start(app);
    const hang = s.fetch("/hang");
    await new Promise((res) => setTimeout(res, 20));
    const started = Date.now();
    await app.close();
    expect(Date.now() - started).toBeLessThan(1000);
    await expect(hang).rejects.toThrow();
    expect(lines.some((l) => l.msg === "shutdown deadline reached; closing open connections")).toBe(
      true,
    );
  });

  it("installs signal handlers by default and removes them on close", async () => {
    const before = process.listenerCount("SIGTERM");
    const app = createApp({
      logger: { startup: false, pretty: false },
      shutdown: { signals: true },
    });
    await app.listen(0, "127.0.0.1");
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    await app.close();
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("startup: false silences listen and shutdown lines; cookies.secret enables signed cookies", async () => {
    const { logger, lines } = captureLogger();
    const app = createApp({
      logger: { startup: false, pretty: false },
      shutdown: { signals: false },
    });
    // replace the root logger the app created with our capturing one
    Object.assign(app, { logger });
    const r = new Router();
    r.get("/x").handle(() => "ok");
    app.mount(r);
    await app.listen(0, "127.0.0.1");
    await app.close();
    expect(lines.filter((l) => l.msg === "listening" || l.msg === "closed")).toHaveLength(0);

    const signed = createApp({ logger, cookies: { secret: "k" }, shutdown: { signals: false } });
    const sr = new Router();
    sr.get("/set").handle((ctx) => {
      ctx.cookies.setSigned("s", "v");
      return "ok";
    });
    sr.get("/get").handle((ctx) => ctx.cookies.getSigned("s") ?? "none");
    signed.mount(sr);
    const s = await start(signed);
    try {
      const cookie = (await s.fetch("/set")).headers.getSetCookie()[0]?.split(";")[0] ?? "";
      expect(await (await s.fetch("/get", { headers: { cookie } })).text()).toBe("v");
    } finally {
      await s.close();
    }
  });

  it("app-level ctx middleware runs for every request, including 404s, and app hooks fire", async () => {
    const { options } = quiet();
    const app = createApp(options);
    const seen: string[] = [];
    const tag: Middleware = async (ctx, next) => {
      seen.push(`in:${ctx.path}`);
      await next();
      seen.push(`out:${ctx.path}:${ctx.res.statusCode}`);
    };
    app.use(tag);
    const expressTag: RequestHandler = (req, _res, next) => {
      seen.push(`express:${req.path}`);
      next();
    };
    app.use(expressTag);
    app.onError((_ctx, err) => {
      seen.push(`error:${(err as Error).message}`);
    });
    const r = new Router();
    r.get("/x").handle(() => {
      throw new NotFound("thrown");
    });
    app.mount(r);
    const s = await start(app);
    try {
      await s.fetch("/x");
      await s.fetch("/missing");
      await new Promise((res) => setTimeout(res, 10));
      expect(seen).toEqual([
        "in:/x",
        "express:/x",
        "error:thrown",
        "out:/x:404",
        "in:/missing",
        "express:/missing",
        "error:No route for GET /missing",
        "out:/missing:404",
      ]);
    } finally {
      await s.close();
    }
  });

  it("rejects a second listen() and exposes the raw express instance", async () => {
    const { options } = quiet();
    const app = createApp(options);
    app.express.set("trust proxy", 1);
    expect(app.express.get("trust proxy")).toBe(1);
    await app.listen(0, "127.0.0.1");
    await expect(app.listen(0)).rejects.toThrow(/already called/);
    await app.close();
  });
});
