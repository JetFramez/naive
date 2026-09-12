import { describe, expect, it } from "vitest";
import {
  type BaseCtx,
  currentBaseCtx,
  currentCtx,
  log,
  Router,
  requireCtx,
  runWithCtx,
} from "../../src/index.js";
import { withApp } from "../helpers/http.js";

describe("ambient context", () => {
  it("is undefined outside a request and requireCtx throws", () => {
    expect(currentCtx()).toBeUndefined();
    expect(currentBaseCtx()).toBeUndefined();
    expect(() => requireCtx()).toThrow(/outside of a request/);
  });

  it("is available in handlers, middleware and awaited service code on bare Express", async () => {
    const service = async () => {
      await new Promise((r) => setTimeout(r, 1));
      return requireCtx().requestId;
    };
    const r = new Router().use(async (ctx, next) => {
      expect(currentCtx()).toBe(ctx);
      await next();
    });
    r.get("/x").handle(async (ctx) => ({
      same: (await service()) === ctx.requestId,
      kind: currentBaseCtx()?.kind,
    }));
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect(await (await fetch("/x")).json()).toEqual({ same: true, kind: "http" });
      },
    );
  });

  it("does not leak between concurrent requests", async () => {
    const r = new Router();
    r.get("/:id").handle(async (ctx) => {
      await new Promise((res) => setTimeout(res, Number(ctx.params.id) % 3));
      return { id: ctx.params.id, ambient: requireCtx().params.id };
    });
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const results = await Promise.all(
          Array.from({ length: 12 }, (_, i) => fetch(`/${i}`).then((res) => res.json())),
        );
        for (const [i, r] of results.entries())
          expect(r).toEqual({ id: String(i), ambient: String(i) });
      },
    );
  });
});

describe("runWithCtx", () => {
  it("creates a job context with defaults and makes it ambient", () => {
    const out = runWithCtx({}, (ctx) => {
      expect(currentBaseCtx()).toBe(ctx);
      expect(currentCtx()).toBeUndefined();
      expect(ctx.kind).toBe("job");
      expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(ctx.state).toEqual({});
      return 42;
    });
    expect(out).toBe(42);
    expect(currentBaseCtx()).toBeUndefined();
  });

  it("accepts overrides and supports async bodies and nesting", async () => {
    await runWithCtx({ kind: "cli", requestId: "cli-1", state: { a: 1 } }, async (outer) => {
      await Promise.resolve();
      expect(currentBaseCtx()?.requestId).toBe("cli-1");
      runWithCtx({ requestId: "inner" }, (inner: BaseCtx) => {
        expect(currentBaseCtx()).toBe(inner);
      });
      expect(currentBaseCtx()).toBe(outer);
      expect(outer.state).toEqual({ a: 1 });
    });
  });

  it("bind() adds fields to subsequent log lines", () => {
    runWithCtx({}, (ctx) => {
      const before = ctx.log;
      ctx.bind({ jobName: "sync" });
      expect(ctx.log).not.toBe(before);
      expect(log.isLevelEnabled("info")).toBe(ctx.log.isLevelEnabled("info"));
    });
  });
});
