import { Router } from "@notio-internal/core";
import { describe, expect, it } from "vitest";
import { csrf } from "../src/csrf.js";
import { withApp } from "./helpers/http.js";

describe("csrf", () => {
  it("issues a token cookie on the first request and does not require it for safe methods", async () => {
    const router = new Router().use(csrf());
    router.get("/x").handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const res = await fetch("/x");
        expect(res.status).toBe(200);
        expect(res.headers.getSetCookie()[0]).toMatch(/^csrf=/);
      },
    );
  });

  it("rejects a state-changing request without a matching header, and accepts one with it", async () => {
    const router = new Router().use(csrf());
    router.post("/x").handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const first = await fetch("/x", { method: "POST" });
        expect(first.status).toBe(403);
        const cookie = first.headers.getSetCookie()[0]?.split(";")[0] ?? "";
        const token = cookie.split("=")[1] ?? "";
        const bad = await fetch("/x", {
          method: "POST",
          headers: { cookie, "x-csrf-token": "wrong" },
        });
        expect(bad.status).toBe(403);
        const good = await fetch("/x", {
          method: "POST",
          headers: { cookie, "x-csrf-token": token },
        });
        expect(good.status).toBe(200);
      },
    );
  });

  it("supports custom cookie/header names and safe methods", async () => {
    const router = new Router().use(
      csrf({ cookie: "xsrf", header: "x-xsrf", safeMethods: ["GET", "PUT"] }),
    );
    router.put("/x").handle(() => "ok");
    router.post("/y").handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const put = await fetch("/x", { method: "PUT" });
        expect(put.status).toBe(200); // PUT is "safe" per this config
        const cookie = put.headers.getSetCookie()[0]?.split(";")[0] ?? "";
        expect(cookie.startsWith("xsrf=")).toBe(true);
        const token = cookie.split("=")[1] ?? "";
        expect((await fetch("/y", { method: "POST", headers: { cookie } })).status).toBe(403);
        expect(
          (await fetch("/y", { method: "POST", headers: { cookie, "x-xsrf": token } })).status,
        ).toBe(200);
      },
    );
  });
});
