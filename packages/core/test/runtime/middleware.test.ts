import type { ErrorRequestHandler, RequestHandler } from "express";
import { describe, expect, it } from "vitest";
import { Forbidden, guard, type Middleware, NotFound, Router } from "../../src/index.js";
import { withApp } from "../helpers/http.js";

interface User {
  id: string;
}

describe("middleware chain", () => {
  it("runs in registration order, outer to inner, with onion unwinding", async () => {
    const log: string[] = [];
    const mw =
      (name: string): Middleware =>
      async (_ctx, next) => {
        log.push(`${name}:in`);
        await next();
        log.push(`${name}:out`);
      };
    const r = new Router().use(mw("a"), mw("b"));
    r.get("/x")
      .use(mw("c"))
      .handle(() => {
        log.push("handler");
        return "ok";
      });
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        await fetch("/x");
        expect(log).toEqual(["a:in", "b:in", "c:in", "handler", "c:out", "b:out", "a:out"]);
      },
    );
  });

  it("lets middleware set headers after next() because sending happens after the chain", async () => {
    const r = new Router().use(async (ctx, next) => {
      const start = Date.now();
      await next();
      ctx.set("x-elapsed", String(Date.now() - start));
    });
    r.get("/x").handle(() => ({ ok: true }));
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const res = await fetch("/x");
        expect(res.status).toBe(200);
        expect(res.headers.get("x-elapsed")).toMatch(/^\d+$/);
      },
    );
  });

  it("narrows ctx at runtime: Adds are visible downstream", async () => {
    const authed: Middleware<{ user: User }> = async (ctx, next) => {
      ctx.user = { id: ctx.headers.get("x-user") ?? "anon" };
      await next();
    };
    const r = new Router().use(authed);
    r.get("/me").handle((ctx) => ctx.user);
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect(await (await fetch("/me", { headers: { "x-user": "u1" } })).json()).toEqual({
          id: "u1",
        });
      },
    );
  });

  it("forwards thrown errors to the Express error path", async () => {
    const r = new Router();
    r.get("/nf").handle(() => {
      throw new NotFound("no such thing", { id: 1 });
    });
    r.get("/mw")
      .use(async () => {
        throw new Forbidden();
      })
      .handle(() => "unreachable");
    r.get("/plain").handle(() => {
      throw new Error("boom");
    });
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const nf = await fetch("/nf");
        expect(nf.status).toBe(404);
        expect(await nf.json()).toEqual({
          code: "NOT_FOUND",
          message: "no such thing",
          details: { id: 1 },
          requestId: expect.any(String),
        });
        expect((await fetch("/mw")).status).toBe(403);
        const plain = await fetch("/plain");
        expect(plain.status).toBe(500);
        expect((await plain.json()).message).toBe("boom");
      },
    );
  });

  it("accepts a returned descriptor from middleware that does not call next()", async () => {
    const r = new Router().use(async (ctx, next) => {
      if (ctx.headers.has("x-short")) return ctx.json({ short: true }, { status: 200 });
      await next();
    });
    r.get("/x").handle(() => "long");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect(await (await fetch("/x")).text()).toBe("long");
        expect(await (await fetch("/x", { headers: { "x-short": "1" } })).json()).toEqual({
          short: true,
        });
      },
    );
  });

  it("allows middleware to respond through ctx.res directly", async () => {
    const r = new Router().use(async (ctx, next) => {
      if (ctx.path === "/direct") {
        ctx.res.status(200).send("from middleware");
        return;
      }
      await next();
    });
    r.get("/direct").handle(() => "handler");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect(await (await fetch("/direct")).text()).toBe("from middleware");
      },
    );
  });

  it("raises Internal when middleware neither responds nor calls next()", async () => {
    const r = new Router().use(async () => {});
    r.get("/x").handle(() => "never");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const res = await fetch("/x");
        expect(res.status).toBe(500);
        expect((await res.json()).message).toMatch(/without responding or calling next/);
      },
    );
  });

  it("rejects calling next() twice", async () => {
    const r = new Router().use(async (_ctx, next) => {
      await next();
      await next();
    });
    r.get("/x").handle(() => "ok");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const res = await fetch("/x");
        expect(res.status).toBe(500);
        expect((await res.json()).message).toMatch(/more than once/);
      },
    );
  });

  it("guard() throws the error when the predicate is falsy", async () => {
    const r = new Router().use(
      guard(
        (ctx) => ctx.headers.get("x-admin") === "1",
        () => new Forbidden("admins only"),
      ),
    );
    r.get("/x").handle(() => "secret");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect((await fetch("/x")).status).toBe(403);
        expect(await (await fetch("/x", { headers: { "x-admin": "1" } })).text()).toBe("secret");
      },
    );
  });
});

describe("Express middleware in the chain", () => {
  it("runs (req, res, next) handlers untouched, in order", async () => {
    const log: string[] = [];
    const tag: RequestHandler = (req, res, next) => {
      log.push("express");
      res.setHeader("x-express", req.method);
      next();
    };
    const r = new Router()
      .use(async (_ctx, next) => {
        log.push("ctx:in");
        await next();
        log.push("ctx:out");
      })
      .use(tag);
    r.get("/x").handle(() => {
      log.push("handler");
      return "ok";
    });
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const res = await fetch("/x");
        expect(res.headers.get("x-express")).toBe("GET");
        expect(log).toEqual(["ctx:in", "express", "handler", "ctx:out"]);
      },
    );
  });

  it("lets an Express handler end the response without calling next()", async () => {
    const preflight: RequestHandler = (req, res, next) => {
      if (req.headers["x-stop"]) {
        res.status(200).send("stopped");
        return;
      }
      next();
    };
    const r = new Router().use(preflight);
    r.get("/x").handle(() => "handler");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect(await (await fetch("/x", { headers: { "x-stop": "1" } })).text()).toBe("stopped");
        expect(await (await fetch("/x")).text()).toBe("handler");
      },
    );
  });

  it("forwards next(err) from Express middleware as a thrown error", async () => {
    const failing: RequestHandler = (_req, _res, next) => next(new NotFound("from express"));
    const r = new Router().use(failing);
    r.get("/x").handle(() => "handler");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const res = await fetch("/x");
        expect(res.status).toBe(404);
        expect((await res.json()).message).toBe("from express");
      },
    );
  });

  it("honours next('route') by skipping to the next matching route", async () => {
    const skip: RequestHandler = (req, _res, next) => {
      if (req.headers["x-skip"]) next("route");
      else next();
    };
    const r = new Router();
    r.get("/x")
      .use(skip)
      .handle(() => "first");
    r.get("/x").handle(() => "second");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect(await (await fetch("/x")).text()).toBe("first");
        expect(await (await fetch("/x", { headers: { "x-skip": "1" } })).text()).toBe("second");
      },
    );
  });

  it("gives (err, req, res, next) handlers the errors thrown downstream of them", async () => {
    const rescue: ErrorRequestHandler = (err, _req, res, next) => {
      if (err instanceof NotFound) {
        res.status(200).json({ rescued: true });
        return;
      }
      next(err);
    };
    const r = new Router().use(rescue);
    r.get("/nf").handle(() => {
      throw new NotFound();
    });
    r.get("/other").handle(() => {
      throw new Forbidden();
    });
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect(await (await fetch("/nf")).json()).toEqual({ rescued: true });
        expect((await fetch("/other")).status).toBe(403);
      },
    );
  });
});
