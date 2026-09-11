import express from "express";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Router } from "../../src/index.js";
import { json, withApp } from "../helpers/http.js";

describe("request validation", () => {
  it("transforms params through the schema", async () => {
    const r = new Router("/orders");
    r.get("/:id")
      .params(z.object({ id: z.coerce.number().int() }))
      .handle((ctx) => ({ id: ctx.params.id, type: typeof ctx.params.id }));
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect(await (await fetch("/orders/42")).json()).toEqual({ id: 42, type: "number" });
        const bad = await fetch("/orders/abc");
        expect(bad.status).toBe(422);
        const body = await bad.json();
        expect(body.code).toBe("VALIDATION");
        expect(body.details.in).toBe("params");
        expect(body.details.issues[0]).toMatchObject({ path: "id", code: expect.any(String) });
      },
    );
  });

  it("coerces query values and normalises single values to arrays", async () => {
    const r = new Router();
    r.get("/q")
      .query(
        z.object({
          page: z.coerce.number().default(1),
          tags: z.array(z.string()).optional(),
          on: z.enum(["true", "false"]).optional(),
        }),
      )
      .handle((ctx) => ctx.query);
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect(await (await fetch("/q")).json()).toEqual({ page: 1 });
        expect(await (await fetch("/q?page=3&tags=a")).json()).toEqual({ page: 3, tags: ["a"] });
        expect(await (await fetch("/q?tags=a&tags=b")).json()).toEqual({
          page: 1,
          tags: ["a", "b"],
        });
        const bad = await fetch("/q?page=x");
        expect(bad.status).toBe(422);
        expect((await bad.json()).details.in).toBe("query");
      },
    );
  });

  it("validates headers and exposes them through ctx.headers.all()", async () => {
    const r = new Router();
    r.get("/h")
      .headers(v.object({ "x-api-key": v.pipe(v.string(), v.minLength(3)) }))
      .handle((ctx) => ({ all: ctx.headers.all(), raw: ctx.headers.get("x-api-key") }));
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const ok = await fetch("/h", { headers: { "x-api-key": "secret" } });
        expect(await ok.json()).toEqual({ all: { "x-api-key": "secret" }, raw: "secret" });
        const bad = await fetch("/h", { headers: { "x-api-key": "s" } });
        expect(bad.status).toBe(422);
        const body = await bad.json();
        expect(body.details.in).toBe("headers");
        expect(body.details.issues[0].path).toBe("x-api-key");
      },
    );
  });

  it("validates the body and reports nested paths", async () => {
    const r = new Router();
    r.post("/b")
      .body(z.object({ items: z.array(z.object({ qty: z.number().positive() })) }))
      .handle((ctx) => ctx.body);
    await withApp(
      (app) => {
        app.use(express.json());
        app.use(r);
      },
      async ({ fetch }) => {
        const ok = await fetch("/b", json({ items: [{ qty: 2 }], extra: "stripped" }));
        expect(ok.status).toBe(201);
        expect(await ok.json()).toEqual({ items: [{ qty: 2 }] });
        const bad = await fetch("/b", json({ items: [{ qty: 1 }, { qty: -1 }] }));
        expect(bad.status).toBe(422);
        const body = await bad.json();
        expect(body.details.in).toBe("body");
        expect(body.details.issues[0].path).toBe("items.1.qty");
      },
    );
  });

  it("reports only the first failing section, in params/query/headers/body order", async () => {
    const r = new Router();
    r.post("/:id")
      .params(z.object({ id: z.coerce.number() }))
      .query(z.object({ q: z.string() }))
      .body(z.object({ n: z.number() }))
      .handle(() => "ok");
    await withApp(
      (app) => {
        app.use(express.json());
        app.use(r);
      },
      async ({ fetch }) => {
        const both = await fetch("/nope", json({}));
        expect((await both.json()).details.in).toBe("params");
        const queryAndBody = await fetch("/1", json({}));
        expect((await queryAndBody.json()).details.in).toBe("query");
        const bodyOnly = await fetch("/1?q=x", json({}));
        expect((await bodyOnly.json()).details.in).toBe("body");
      },
    );
  });

  it("runs validation after router middleware and before route middleware", async () => {
    const order: string[] = [];
    const r = new Router().use(async (_ctx, next) => {
      order.push("router");
      await next();
    });
    r.get("/:id")
      .params(z.object({ id: z.coerce.number() }))
      .use(async (ctx, next) => {
        order.push(`route:${typeof ctx.params.id}`);
        await next();
      })
      .handle(() => {
        order.push("handler");
        return "ok";
      });
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        await fetch("/x");
        expect(order).toEqual(["router"]);
        order.length = 0;
        await fetch("/5");
        expect(order).toEqual(["router", "route:number", "handler"]);
      },
    );
  });
});

describe("response validation", () => {
  const Order = z.object({ id: z.string(), total: z.number() });

  it("throws Internal outside production when the return value does not match", async () => {
    const r = new Router();
    r.get("/ok")
      .response(Order)
      .handle(() => ({ id: "1", total: 2 }));
    r.get("/bad")
      .response(Order)
      .handle(() => ({ id: "1" }) as never);
    r.get("/desc")
      .response(Order)
      .handle((ctx) => ctx.json({ id: "1" } as never));
    r.get("/text")
      .response(Order)
      .handle((ctx) => ctx.text("not checked"));
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect((await fetch("/ok")).status).toBe(200);
        const bad = await fetch("/bad");
        expect(bad.status).toBe(500);
        expect((await bad.json()).details.in).toBe("response");
        expect((await fetch("/desc")).status).toBe(500);
        expect((await fetch("/text")).status).toBe(200);
      },
    );
  });

  it("can be disabled per router", async () => {
    const r = new Router("", { validateResponses: false });
    r.get("/bad")
      .response(Order)
      .handle(() => ({ id: "1" }) as never);
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect((await fetch("/bad")).status).toBe(200);
      },
    );
  });

  it("is skipped in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const r = new Router();
      r.get("/bad")
        .response(Order)
        .handle(() => ({ id: "1" }) as never);
      await withApp(
        (app) => app.use(r),
        async ({ fetch }) => {
          expect((await fetch("/bad")).status).toBe(200);
        },
      );
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
