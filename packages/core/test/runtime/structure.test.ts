import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Ctx, NotFound, Router, wasHandledByRouter } from "../../src/index.js";
import { withApp } from "../helpers/http.js";

describe("groups, mounts, statics, redirects", () => {
  it("compiles groups with inherited prefix and middleware", async () => {
    const r = new Router("/api").use(async (ctx, next) => {
      ctx.state.seen = ["router"];
      await next();
    });
    r.group(
      "/admin",
      [
        async (ctx, next) => {
          (ctx.state.seen as string[]).push("group");
          await next();
        },
      ],
      (admin) => {
        admin.get("/users/:id").handle((ctx) => ({ id: ctx.params.id, seen: ctx.state.seen }));
      },
    );
    r.get("/plain").handle((ctx) => ctx.state.seen);
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect(await (await fetch("/api/admin/users/7")).json()).toEqual({
          id: "7",
          seen: ["router", "group"],
        });
        expect(await (await fetch("/api/plain")).json()).toEqual(["router"]);
      },
    );
  });

  it("compiles mounts under the parent's prefix", async () => {
    const users = new Router("/users");
    users.get("/:id").handle((ctx) => ({ id: ctx.params.id, route: ctx.route }));
    const api = new Router("/api");
    api.mount("/v1", users);
    await withApp(
      (app) => app.use(api),
      async ({ fetch }) => {
        expect(await (await fetch("/api/v1/users/9")).json()).toEqual({
          id: "9",
          route: "GET /api/v1/users/:id",
        });
      },
    );
  });

  it("respects registration order between routes and groups", async () => {
    const r = new Router();
    r.group("/a", (g) => {
      g.get("/x").handle(() => "group");
    });
    r.get("/*rest").handle(() => "catchall");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect(await (await fetch("/a/x")).text()).toBe("group");
        expect(await (await fetch("/anything")).text()).toBe("catchall");
      },
    );
  });

  it("serves statics with duration maxAge and optional SPA fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "notio-static-"));
    writeFileSync(join(dir, "index.html"), "<h1>app</h1>");
    mkdirSync(join(dir, "css"));
    writeFileSync(join(dir, "css", "a.css"), "body{}");
    const r = new Router("/app");
    r.static("/assets", dir, { maxAge: "1d", immutable: true });
    r.static("/spa", dir, { spa: true });
    r.get("/after").handle(() => "route");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const css = await fetch("/app/assets/css/a.css");
        expect(css.status).toBe(200);
        expect(css.headers.get("cache-control")).toBe("public, max-age=86400, immutable");
        expect((await fetch("/app/assets/missing.css")).status).toBe(404);
        const deep = await fetch("/app/spa/some/client/route", {
          headers: { accept: "text/html" },
        });
        expect(deep.status).toBe(200);
        expect(await deep.text()).toBe("<h1>app</h1>");
        expect(
          (await fetch("/app/spa/api.json", { headers: { accept: "application/json" } })).status,
        ).toBe(404);
        expect(await (await fetch("/app/after")).text()).toBe("route");
      },
    );
  });

  it("redirects with the configured status", async () => {
    const r = new Router("/r");
    r.redirect("/old", "/new");
    r.redirect("/perm", "https://example.com/", 301);
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const a = await fetch("/r/old");
        expect(a.status).toBe(302);
        expect(a.headers.get("location")).toBe("/new");
        const b = await fetch("/r/perm");
        expect(b.status).toBe(301);
        expect(b.headers.get("location")).toBe("https://example.com/");
      },
    );
  });
});

describe("router hooks", () => {
  it("fire onRequest, onResponse with the result, and onError once, outer router first", async () => {
    const events: string[] = [];
    const parent = new Router("/p")
      .onRequest(() => {
        events.push("parent:request");
      })
      .onResponse((_ctx, result) => {
        events.push(`parent:response:${JSON.stringify(result)}`);
      })
      .onError((_ctx, err) => {
        events.push(`parent:error:${(err as Error).message}:${wasHandledByRouter(err)}`);
      });
    parent.group("/g", (g) => {
      g.onRequest(() => {
        events.push("group:request");
      });
      g.get("/ok").handle(() => ({ ok: 1 }));
      g.get("/fail").handle(() => {
        throw new NotFound("gone");
      });
    });
    await withApp(
      (app) => app.use(parent),
      async ({ fetch }) => {
        await fetch("/p/g/ok");
        expect(events).toEqual(["parent:request", "group:request", 'parent:response:{"ok":1}']);
        events.length = 0;
        await fetch("/p/g/fail");
        expect(events).toEqual(["parent:request", "group:request", "parent:error:gone:true"]);
      },
    );
  });

  it("errors thrown by onResponse hooks do not affect the response", async () => {
    const r = new Router().onResponse(() => {
      throw new Error("hook bug");
    });
    r.get("/x").handle(() => "ok");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const res = await fetch("/x");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("ok");
      },
    );
  });
});

describe("ctx fields", () => {
  it("exposes request metadata", async () => {
    const r = new Router("/orders");
    let captured: Partial<Ctx> = {};
    r.get("/:id").handle((ctx) => {
      captured = {
        method: ctx.method,
        path: ctx.path,
        route: ctx.route,
        ip: ctx.ip,
        requestId: ctx.requestId,
      };
      return {
        href: ctx.url.href.replace(/127\.0\.0\.1:\d+/, "host"),
        search: ctx.url.searchParams.get("q"),
        bearer: ctx.bearer(),
        accepts: ctx.accepts("json", "html"),
        kind: ctx.kind,
      };
    });
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const res = await fetch("/orders/3?q=1", {
          headers: { authorization: "Bearer tok", accept: "text/html", "x-request-id": "rid-1" },
        });
        expect(await res.json()).toEqual({
          href: "http://host/orders/3?q=1",
          search: "1",
          bearer: "tok",
          accepts: "html",
          kind: "http",
        });
        expect(captured).toEqual({
          method: "GET",
          path: "/orders/3",
          route: "GET /orders/:id",
          ip: "127.0.0.1",
          requestId: "rid-1",
        });
        const generated = await fetch("/orders/3");
        expect(generated.status).toBe(200);
      },
    );
  });

  it("generates a request id when none is supplied", async () => {
    const r = new Router();
    r.get("/id").handle((ctx) => ctx.requestId);
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect(await (await fetch("/id")).text()).toMatch(/^[0-9a-f-]{36}$/);
      },
    );
  });
});
