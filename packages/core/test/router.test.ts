import { describe, expect, it } from "vitest";
import { joinPath, paramNames, Router } from "../src/index.js";

const noop = async (_ctx: unknown, next: () => Promise<void>) => {
  await next();
};

describe("paramNames", () => {
  it("extracts names in order", () => {
    expect(paramNames("/orders/:id/lines/:lineId")).toEqual(["id", "lineId"]);
    expect(paramNames("/files/*path")).toEqual(["path"]);
    expect(paramNames("/files/:name.:ext")).toEqual(["name", "ext"]);
    expect(paramNames("/users{/:id}")).toEqual(["id"]);
    expect(paramNames("/plain")).toEqual([]);
  });
});

describe("joinPath", () => {
  it("collapses slashes and trims the trailing one", () => {
    expect(joinPath("/orders", "/:id")).toBe("/orders/:id");
    expect(joinPath("/orders/", "/")).toBe("/orders");
    expect(joinPath("", "/")).toBe("/");
    expect(joinPath("", "")).toBe("/");
    expect(joinPath("/a", "")).toBe("/a");
  });
});

describe("Router definitions", () => {
  it("records routes with full paths and metadata", () => {
    const router = new Router("/orders");
    router
      .post("/")
      .summary("Create")
      .tags("orders", "write")
      .deprecated()
      .handle(() => "ok");
    router
      .get("/:id")
      .hidden()
      .handle(() => "ok");

    const routes = router.routes();
    expect(routes.map((r) => [r.method, r.path])).toEqual([
      ["POST", "/orders"],
      ["GET", "/orders/:id"],
    ]);
    expect(routes[0]).toMatchObject({
      summary: "Create",
      tags: ["orders", "write"],
      deprecated: true,
      hidden: false,
      params: [],
    });
    expect(routes[1]).toMatchObject({ hidden: true, params: ["id"] });
  });

  it("does not list routes until handle() is called", () => {
    const router = new Router();
    router.get("/x");
    expect(router.routes()).toEqual([]);
  });

  it("records schemas, uploads, responses and errors", () => {
    const schema = {
      "~standard": { version: 1 as const, vendor: "t", validate: (v: unknown) => ({ value: v }) },
    };
    class NotFound extends Error {
      readonly status = 404;
      readonly code = "NOT_FOUND";
    }
    const router = new Router();
    const info = router
      .post("/x")
      .query(schema)
      .body(schema)
      .headers(schema)
      .uploads({ file: { maxSize: "1mb" } })
      .response(schema)
      .response(202, schema)
      .errors(NotFound)
      .handle(() => "ok");
    expect(info.schemas).toEqual({ query: schema, body: schema, headers: schema });
    expect(info.uploads).toEqual({ file: { maxSize: "1mb" } });
    expect(info.responses).toEqual([
      { status: 201, schema },
      { status: 202, schema },
    ]);
    expect(info.errors).toEqual([NotFound]);
  });

  it("orders middleware outer to inner: router, group, route", () => {
    const a = async (_c: unknown, n: () => Promise<void>) => n();
    const b = async (_c: unknown, n: () => Promise<void>) => n();
    const c = async (_c: unknown, n: () => Promise<void>) => n();
    const router = new Router("/api").use(a);
    router.group("/admin", [b], (r) => {
      r.get("/x")
        .use(c)
        .handle(() => "ok");
    });
    const [route] = router.routes();
    expect(route?.path).toBe("/api/admin/x");
    expect(route?.middleware).toEqual([a, b, c]);
  });

  it("applies router middleware only to routes registered after it", () => {
    const router = new Router();
    router.get("/before").handle(() => "ok");
    router.use(noop);
    router.get("/after").handle(() => "ok");
    const [before, after] = router.routes();
    expect(before?.middleware).toEqual([]);
    expect(after?.middleware).toEqual([noop]);
  });

  it("mounts routers under a path, keeping their own prefix", () => {
    const users = new Router("/users");
    users.get("/:id").handle(() => "ok");
    const api = new Router("/api").use(noop);
    api.mount("/v1", users);
    const [route] = api.routes();
    expect(route?.path).toBe("/api/v1/users/:id");
    expect(route?.middleware).toEqual([noop]);
  });

  it("nests groups and mounts inside groups", () => {
    const inner = new Router("/inner");
    inner.get("/leaf").handle(() => "ok");
    const router = new Router("/a");
    router.group("/b", (b) => {
      b.group("/c", (c) => {
        c.get("/d").handle(() => "ok");
      });
      b.mount("/m", inner);
    });
    expect(router.routes().map((r) => r.path)).toEqual(["/a/b/c/d", "/a/b/m/inner/leaf"]);
  });

  it("records statics and redirects with prefixes and middleware", () => {
    const router = new Router("/app").use(noop);
    router.static("/assets", "./public", { maxAge: "1d", spa: true });
    router.redirect("/old", "/new");
    router.redirect("/gone", "/elsewhere", 301);
    expect(router.statics()).toEqual([
      {
        path: "/app/assets",
        dir: "./public",
        options: { maxAge: "1d", spa: true },
        middleware: [noop],
      },
    ]);
    expect(router.redirects()).toEqual([
      { from: "/app/old", to: "/new", status: 302, middleware: [noop] },
      { from: "/app/gone", to: "/elsewhere", status: 301, middleware: [noop] },
    ]);
  });

  it("keeps hooks per router", () => {
    const router = new Router();
    const hook = () => {};
    router.onRequest(hook).onResponse(hook).onError(hook);
    expect(router.hooks()).toEqual({ onRequest: [hook], onResponse: [hook], onError: [hook] });
  });
});
