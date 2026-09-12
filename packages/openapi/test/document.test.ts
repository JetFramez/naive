import { cookieSession, createAuth } from "@notio-internal/auth";
import { type App, createApp, Forbidden, NotFound, Router } from "@notio-internal/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildDocument } from "../src/document.js";

interface User {
  readonly id: string;
}

const adapter = {
  findUserById: async () => null,
  findUserByEmail: async () => null,
  createSession: async () => {},
  findSession: async () => null,
  updateSession: async () => {},
  deleteSession: async () => {},
  deleteSessionsByFamily: async () => {},
  deleteSessionsByUser: async () => {},
};

describe("buildDocument", () => {
  it("documents path, query, header and body parameters", async () => {
    const router = new Router("/orders");
    router
      .get("/:id")
      .params(z.object({ id: z.coerce.number() }))
      .query(z.object({ expand: z.string().optional() }))
      .headers(z.object({ "x-trace": z.string() }))
      .summary("Fetch one order")
      .tags("orders")
      .handle(() => "ok");
    router
      .post("/")
      .body(z.object({ total: z.number() }))
      .handle(() => "ok");

    const document = buildDocument(router.routes(), { info: { title: "t", version: "1" } });
    const get = document.paths["/orders/{id}"]?.get as Record<string, unknown>;
    expect(get.summary).toBe("Fetch one order");
    expect(get.tags).toEqual(["orders"]);
    expect(get.parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "number" } },
      { name: "expand", in: "query", required: false, schema: { type: "string" } },
      { name: "x-trace", in: "header", required: true, schema: { type: "string" } },
    ]);

    const post = document.paths["/orders"]?.post as Record<string, unknown>;
    expect(post.requestBody).toEqual({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { total: { type: "number" } },
            required: ["total"],
            additionalProperties: false,
          },
        },
      },
    });
  });

  it("groups multiple methods under one path entry", async () => {
    const router = new Router();
    router.get("/x").handle(() => "ok");
    router.post("/x").handle(() => "ok");
    router.delete("/x").handle(() => "ok");
    const document = buildDocument(router.routes(), { info: { title: "t", version: "1" } });
    expect(Object.keys(document.paths)).toEqual(["/x"]);
    expect(Object.keys(document.paths["/x"] ?? {}).sort()).toEqual(["delete", "get", "post"]);
  });

  it("skips hidden routes entirely", async () => {
    const router = new Router();
    router.get("/visible").handle(() => "ok");
    router
      .get("/secret")
      .hidden()
      .handle(() => "ok");
    const document = buildDocument(router.routes(), { info: { title: "t", version: "1" } });
    expect(Object.keys(document.paths)).toEqual(["/visible"]);
  });

  it("documents an explicit .response() and applies wrapResponse", async () => {
    const Order = z.object({ id: z.string() }).meta({ id: "Order", title: "Order" });
    const router = new Router();
    router
      .get("/x")
      .response(Order)
      .handle(() => ({ id: "1" }));

    const withoutWrap = buildDocument(router.routes(), {
      info: { title: "t", version: "1" },
    });
    const opWithout = withoutWrap.paths["/x"]?.get as Record<string, unknown>;
    expect((opWithout.responses as Record<string, unknown>)["200"]).toMatchObject({
      content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } },
    });
    expect(withoutWrap.components.schemas.Order).toMatchObject({ title: "Order" });

    const wrapped = buildDocument(router.routes(), {
      info: { title: "t", version: "1" },
      wrapResponse: (schema) => ({
        type: "object",
        properties: { data: schema },
        required: ["data"],
      }),
    });
    const opWrapped = wrapped.paths["/x"]?.get as Record<string, unknown>;
    expect((opWrapped.responses as Record<string, unknown>)["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Order" } } },
        },
      },
    });
  });

  it("documents 201 for a POST .response()", async () => {
    const router = new Router();
    router
      .post("/x")
      .response(z.object({ id: z.string() }))
      .handle(() => ({ id: "1" }));
    const document = buildDocument(router.routes(), { info: { title: "t", version: "1" } });
    const op = document.paths["/x"]?.post as Record<string, unknown>;
    expect(Object.keys(op.responses as object)).toEqual(["201"]);
  });

  it("documents .errors() using the unified error body, without duplicating an explicit response", async () => {
    const router = new Router();
    router
      .get("/x")
      .errors(NotFound, Forbidden)
      .response(404, z.object({ custom: z.boolean() }))
      .handle(() => "ok");
    const document = buildDocument(router.routes(), { info: { title: "t", version: "1" } });
    const op = document.paths["/x"]?.get as Record<string, unknown>;
    const responses = op.responses as Record<string, { description: string; content: unknown }>;
    // .errors() would default 404 to "NOT_FOUND", but the explicit .response(404, ...) wins.
    expect(responses["404"]?.content).toEqual({
      "application/json": {
        schema: {
          type: "object",
          properties: { custom: { type: "boolean" } },
          required: ["custom"],
          additionalProperties: false,
        },
      },
    });
    expect(responses["403"]).toMatchObject({ description: "FORBIDDEN" });
    const forbiddenContent = responses["403"]?.content as
      | Record<string, { schema: unknown }>
      | undefined;
    expect(forbiddenContent?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/Error",
    });
  });

  it("adds 422 automatically for a route with any input schema, and not otherwise", async () => {
    const router = new Router();
    router
      .get("/validated")
      .query(z.object({ q: z.string() }))
      .handle(() => "ok");
    router.get("/plain").handle(() => "ok");
    const document = buildDocument(router.routes(), { info: { title: "t", version: "1" } });
    const validatedOp = document.paths["/validated"]?.get as Record<string, unknown> | undefined;
    const plainOp = document.paths["/plain"]?.get as Record<string, unknown> | undefined;
    expect(Object.keys((validatedOp?.responses ?? {}) as object)).toContain("422");
    expect(Object.keys((plainOp?.responses ?? {}) as object)).not.toContain("422");
  });

  it("falls back to a bare 200 when a route declares nothing documentable", async () => {
    const router = new Router();
    router.get("/x").handle(() => "ok");
    const document = buildDocument(router.routes(), { info: { title: "t", version: "1" } });
    const op = document.paths["/x"]?.get as Record<string, unknown>;
    expect(op.responses).toEqual({ "200": { description: "Success" } });
  });

  it("documents multipart/form-data for .uploads(), merged with .body() text fields", async () => {
    const router = new Router();
    router
      .post("/x")
      .body(z.object({ caption: z.string() }))
      .uploads({ avatar: { types: ["image/png"] } })
      .handle(() => "ok");
    const document = buildDocument(router.routes(), { info: { title: "t", version: "1" } });
    const op = document.paths["/x"]?.post as Record<string, unknown>;
    expect(op.requestBody).toMatchObject({
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            properties: {
              caption: { type: "string" },
              avatar: {
                type: "string",
                format: "binary",
                description: expect.stringContaining("image/png"),
              },
            },
            required: ["caption", "avatar"],
          },
        },
      },
    });
  });

  it("adds security, 401 and 403 for a route behind auth.require(), naming only configured schemes", async () => {
    const auth = createAuth<User>({
      adapter,
      strategies: { session: cookieSession(), bearer: cookieSession() },
      default: "session",
    });
    const router = new Router();
    router
      .get("/mine")
      .use(auth.require("session"))
      .handle(() => "ok");
    router
      .get("/either")
      .use(auth.require("session", "bearer"))
      .handle(() => "ok");
    router.get("/public").handle(() => "ok");

    const document = buildDocument(router.routes(), {
      info: { title: "t", version: "1" },
      security: { session: { type: "apiKey", in: "cookie", name: "sid" } },
    });

    const mine = document.paths["/mine"]?.get as Record<string, unknown>;
    expect(mine.security).toEqual([{ session: [] }]);
    expect(Object.keys(mine.responses as object)).toEqual(expect.arrayContaining(["401", "403"]));

    // "bearer" has no matching entry in `security`, so only "session" is referenced.
    const either = document.paths["/either"]?.get as Record<string, unknown>;
    expect(either.security).toEqual([{ session: [] }]);

    const pub = document.paths["/public"]?.get as Record<string, unknown>;
    expect(pub.security).toBeUndefined();
    expect(Object.keys(pub.responses as object)).not.toEqual(expect.arrayContaining(["401"]));

    expect(document.components.securitySchemes).toEqual({
      session: { type: "apiKey", in: "cookie", name: "sid" },
    });
  });

  it("is invisible to a hand-rolled auth check that carries no marker", async () => {
    const router = new Router();
    router
      .get("/x")
      .use(async (ctx, next) => {
        if (!ctx.headers.get("authorization")) throw new Forbidden();
        await next();
      })
      .handle(() => "ok");
    const document = buildDocument(router.routes(), { info: { title: "t", version: "1" } });
    const op = document.paths["/x"]?.get as Record<string, unknown>;
    expect(op.security).toBeUndefined();
  });

  it("walks routes aggregated from an App across mounted routers", async () => {
    const app: App = createApp({ shutdown: { signals: false } });
    const users = new Router("/users");
    users.get("/:id").handle(() => "ok");
    app.mount("/api", users);
    const document = buildDocument(app.routes(), { info: { title: "t", version: "1" } });
    expect(Object.keys(document.paths)).toEqual(["/api/users/{id}"]);
  });

  it("includes info, servers and marks deprecated routes", async () => {
    const router = new Router();
    router
      .get("/old")
      .deprecated()
      .handle(() => "ok");
    const document = buildDocument(router.routes(), {
      info: { title: "My API", version: "2.0.0" },
      servers: [{ url: "https://api.example.com" }],
    });
    expect(document.openapi).toBe("3.1.0");
    expect(document.info).toEqual({ title: "My API", version: "2.0.0" });
    expect(document.servers).toEqual([{ url: "https://api.example.com" }]);
    const oldOp = document.paths["/old"]?.get as Record<string, unknown> | undefined;
    expect(oldOp?.deprecated).toBe(true);
  });
});
