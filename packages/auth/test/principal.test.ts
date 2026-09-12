import { type Ctx, currentCtx, Router } from "@notio-internal/core";
import { describe, expect, it } from "vitest";
import { currentUser, requireUser } from "../src/principal.js";
import { withApp } from "./helpers/http.js";

interface User {
  id: string;
}

describe("currentUser / requireUser", () => {
  it("read undefined and throw, respectively, outside a request", () => {
    expect(currentUser()).toBeUndefined();
    expect(() => requireUser()).toThrow(/Authentication required/);
  });

  it("read the user set on ctx by an auth middleware, via ALS", async () => {
    const router = new Router().use(async (ctx, next) => {
      (ctx as Ctx & { user?: User }).user = { id: "u1" };
      await next();
    });
    router.get("/x").handle(() => ({
      viaCurrentCtx: (currentCtx() as (Ctx & { user?: User }) | undefined)?.user,
      viaCurrentUser: currentUser<User>(),
      viaRequireUser: requireUser<User>(),
    }));
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const res = await fetch("/x");
        expect(await res.json()).toEqual({
          viaCurrentCtx: { id: "u1" },
          viaCurrentUser: { id: "u1" },
          viaRequireUser: { id: "u1" },
        });
      },
    );
  });

  it("requireUser throws inside a request with no user set", async () => {
    const router = new Router();
    router.get("/x").handle(() => requireUser());
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const res = await fetch("/x");
        expect(res.status).toBe(401);
      },
    );
  });
});
