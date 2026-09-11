import { describe, expect, it } from "vitest";
import { createCtx, Router } from "../../src/index.js";
import { withApp } from "../helpers/http.js";

describe("cookies", () => {
  it("parses request cookies and writes Set-Cookie with safe defaults", async () => {
    const r = new Router();
    r.get("/read").handle((ctx) => ({ a: ctx.cookies.get("a"), all: ctx.cookies.all() }));
    r.get("/write").handle((ctx) => {
      ctx.cookies.set("sid", "abc", { maxAge: "1h" });
      ctx.cookies.set("plain", "1", { httpOnly: false, sameSite: "strict", path: "/x" });
      ctx.cookies.delete("old");
      return "ok";
    });
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect(await (await fetch("/read", { headers: { cookie: "a=1; b=2" } })).json()).toEqual({
          a: "1",
          all: { a: "1", b: "2" },
        });
        const res = await fetch("/write");
        const set = res.headers.getSetCookie();
        expect(set).toEqual([
          "sid=abc; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax",
          "plain=1; Path=/x; SameSite=Strict",
          "old=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
        ]);
      },
    );
  });

  it("signs and verifies with key rotation, rejecting tampered values", async () => {
    const r = new Router();
    r.get("/sign").handle((ctx) => {
      ctx.cookies.setSigned("s", "hello");
      return "ok";
    });
    r.get("/verify").handle((ctx) => ({ value: ctx.cookies.getSigned("s") ?? null }));
    let secret: string | string[] = "k1";
    await withApp(
      (app) => {
        app.use((req, res, next) => {
          createCtx(req, res, { cookieSecret: secret });
          next();
        });
        app.use(r);
      },
      async ({ fetch }) => {
        const signed = (await fetch("/sign")).headers.getSetCookie()[0]?.split(";")[0];
        expect(signed).toMatch(/^s=hello\.[A-Za-z0-9_-]+$/);
        expect(
          await (await fetch("/verify", { headers: { cookie: signed ?? "" } })).json(),
        ).toEqual({ value: "hello" });
        const tampered = signed?.replace("hello", "hellp") ?? "";
        expect(await (await fetch("/verify", { headers: { cookie: tampered } })).json()).toEqual({
          value: null,
        });
        secret = ["k2", "k1"];
        expect(
          await (await fetch("/verify", { headers: { cookie: signed ?? "" } })).json(),
        ).toEqual({ value: "hello" });
        secret = "k3";
        expect(
          await (await fetch("/verify", { headers: { cookie: signed ?? "" } })).json(),
        ).toEqual({ value: null });
      },
    );
  });

  it("throws a clear error for signed cookies without a secret", async () => {
    const r = new Router();
    r.get("/x").handle((ctx) => ctx.cookies.getSigned("s"));
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const res = await fetch("/x");
        expect(res.status).toBe(500);
        expect((await res.json()).message).toMatch(/cookies: \{ secret \}/);
      },
    );
  });
});
