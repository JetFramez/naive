import { describe, expect, it } from "vitest";
import { context, hooks, NotFound, Router } from "../../src/index.js";
import { withApp } from "../helpers/http.js";
import { captureLogger, LEVEL } from "../helpers/logger.js";

describe("app-level hooks", () => {
  it("run onRequest before routing, onResponse on finish with the result, onError once", async () => {
    const events: string[] = [];
    const r = new Router("/api").onError((_ctx, err) => {
      events.push(`router:error:${(err as Error).message}`);
    });
    r.get("/ok").handle(() => ({ ok: 1 }));
    r.get("/fail").handle(() => {
      throw new NotFound("router-thrown");
    });
    await withApp(
      (app) => {
        hooks(app, {
          onRequest: (ctx) => {
            events.push(`app:request:${ctx.path}`);
          },
          onResponse: (ctx, result) => {
            events.push(`app:response:${ctx.res.statusCode}:${JSON.stringify(result ?? null)}`);
          },
          onError: (_ctx, err) => {
            events.push(`app:error:${(err as Error).message}`);
          },
        });
        app.use(r);
        app.get("/express-fail", () => {
          throw new NotFound("express-thrown");
        });
      },
      async ({ fetch }) => {
        const settle = () => new Promise((res) => setTimeout(res, 10));
        await fetch("/api/ok");
        await settle();
        expect(events).toEqual(["app:request:/api/ok", 'app:response:200:{"ok":1}']);
        events.length = 0;

        await fetch("/api/fail");
        await settle();
        expect(events).toEqual([
          "app:request:/api/fail",
          "router:error:router-thrown",
          "app:error:router-thrown",
          "app:response:404:null",
        ]);
        events.length = 0;

        await fetch("/express-fail");
        await settle();
        expect(events).toEqual([
          "app:request:/express-fail",
          "app:error:express-thrown",
          "app:response:404:null",
        ]);
        events.length = 0;

        await fetch("/nowhere");
        await settle();
        expect(events).toEqual([
          "app:request:/nowhere",
          "app:error:No route for GET /nowhere",
          "app:response:404:null",
        ]);
      },
    );
  });

  it("a throwing onRequest hook fails the request through the error handler", async () => {
    const r = new Router();
    r.get("/x").handle(() => "never");
    await withApp(
      (app) => {
        hooks(app, {
          onRequest: () => {
            throw new NotFound("blocked early");
          },
        });
        app.use(r);
      },
      async ({ fetch }) => {
        const res = await fetch("/x");
        expect(res.status).toBe(404);
        expect((await res.json()).message).toBe("blocked early");
      },
    );
  });

  it("makes the context ambient for Express middleware after it", async () => {
    await withApp(
      (app) => {
        app.use(context());
        app.get("/x", async (_req, res) => {
          const { currentCtx } = await import("../../src/index.js");
          res.json({ has: currentCtx() !== undefined });
        });
      },
      async ({ fetch }) => {
        expect(await (await fetch("/x")).json()).toEqual({ has: true });
      },
    );
  });
});

describe("request log line", () => {
  it("logs one info line per request with method, route, status, duration and bound fields", async () => {
    const { logger, lines } = captureLogger();
    const r = new Router("/orders");
    r.get("/:id").handle((ctx) => {
      ctx.bind({ orderId: ctx.params.id });
      return "ok";
    });
    await withApp(
      (app) => {
        app.use(context({ logger }));
        app.use(context({ logger })); // installing twice must not double the line
        app.use(r);
      },
      async ({ fetch }) => {
        await fetch("/orders/7", { headers: { "x-request-id": "req-7" } });
        await fetch("/nowhere");
        await new Promise((res) => setTimeout(res, 10));
        const requests = lines.filter((l) => l.msg === "request");
        expect(requests).toHaveLength(2);
        expect(requests[0]).toMatchObject({
          level: LEVEL.info,
          method: "GET",
          path: "/orders/7",
          route: "GET /orders/:id",
          status: 200,
          requestId: "req-7",
          orderId: "7",
          duration: expect.any(Number),
        });
        expect(requests[1]).toMatchObject({ path: "/nowhere", status: 404 });
        expect(requests[1]).not.toHaveProperty("route");
      },
    );
  });

  it("can be disabled or filtered", async () => {
    const { logger, lines } = captureLogger();
    const r = new Router();
    r.get("/health").handle(() => "ok");
    r.get("/x").handle(() => "ok");
    await withApp(
      (app) => {
        app.use(context({ logger, requestLog: { ignore: (ctx) => ctx.path === "/health" } }));
        app.use(r);
      },
      async ({ fetch }) => {
        await fetch("/health");
        await fetch("/x");
        await new Promise((res) => setTimeout(res, 10));
        expect(lines.filter((l) => l.msg === "request").map((l) => l.path)).toEqual(["/x"]);
      },
    );
    lines.length = 0;
    await withApp(
      (app) => {
        app.use(context({ logger, requestLog: false }));
        app.use(r);
      },
      async ({ fetch }) => {
        await fetch("/x");
        await new Promise((res) => setTimeout(res, 10));
        expect(lines.filter((l) => l.msg === "request")).toHaveLength(0);
      },
    );
  });
});
