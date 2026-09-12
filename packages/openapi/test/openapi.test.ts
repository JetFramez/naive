import { Router } from "@notio-internal/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openapi } from "../src/openapi.js";
import { withApp } from "./helpers/http.js";

describe("openapi().from()", () => {
  it("builds a spec from one or more route sources", async () => {
    const orders = new Router("/orders");
    orders.get("/:id").handle(() => "ok");
    const users = new Router("/users");
    users.get("/:id").handle(() => "ok");

    const spec = await openapi({ info: { title: "t", version: "1" } }).from(orders, users);
    expect(Object.keys(spec.document.paths).sort()).toEqual(["/orders/{id}", "/users/{id}"]);
  });

  it("returns the same document object docs() serves", async () => {
    const router = new Router();
    router
      .get("/x")
      .response(z.object({ ok: z.boolean() }))
      .handle(() => ({ ok: true }));
    const spec = await openapi({ info: { title: "Demo", version: "1.0.0" } }).from(router);

    await withApp(
      (app) => {
        app.use(spec.docs("/docs"));
      },
      async ({ fetch }) => {
        const json = await fetch("/docs/openapi.json");
        expect(json.status).toBe(200);
        expect(json.headers.get("content-type")).toMatch(/^application\/json/);
        const body = await json.json();
        expect(body).toEqual(spec.document);
        expect(body.info).toEqual({ title: "Demo", version: "1.0.0" });

        const ui = await fetch("/docs");
        expect(ui.status).toBe(200);
        expect(ui.headers.get("content-type")).toMatch(/^text\/html/);
        expect(await ui.text()).toContain("Scalar");
      },
    );
  });

  it("serves the JSON route before the UI catch-all, so it is never swallowed", async () => {
    const router = new Router();
    router.get("/x").handle(() => "ok");
    const spec = await openapi({ info: { title: "t", version: "1" } }).from(router);
    await withApp(
      (app) => app.use(spec.docs("/reference")),
      async ({ fetch }) => {
        const res = await fetch("/reference/openapi.json");
        expect(res.status).toBe(200);
        expect((await res.json()).openapi).toBe("3.1.0");
      },
    );
  });
});
