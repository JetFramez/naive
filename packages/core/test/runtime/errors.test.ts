import express from "express";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  classifyError,
  createCtx,
  defineError,
  errorHandler,
  Forbidden,
  HttpError,
  Internal,
  NotFound,
  notFound,
  Router,
  Unprocessable,
} from "../../src/index.js";
import { json, serve, withApp } from "../helpers/http.js";
import { captureLogger, LEVEL } from "../helpers/logger.js";

describe("HttpError family", () => {
  it("carries status, code, default messages and details", () => {
    expect(new NotFound()).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      message: "Not Found",
      name: "NotFound",
    });
    expect(new Unprocessable("bad", { in: "body" })).toMatchObject({
      status: 422,
      code: "VALIDATION",
      details: { in: "body" },
    });
    expect(new Internal().message).toBe("Internal Server Error");
    expect(new HttpError(418, "TEAPOT")).toMatchObject({
      status: 418,
      code: "TEAPOT",
      message: "I'm a Teapot",
    });
    class Custom extends defineError(451, "LEGAL") {}
    const c = new Custom("blocked");
    expect(c).toBeInstanceOf(HttpError);
    expect(c).toMatchObject({ status: 451, code: "LEGAL", message: "blocked", name: "Custom" });
  });
});

describe("classifyError", () => {
  it("passes HttpError through", () => {
    expect(classifyError(new Forbidden("nope", { why: 1 }), false)).toEqual({
      status: 403,
      code: "FORBIDDEN",
      message: "nope",
      details: { why: 1 },
    });
  });

  it("maps schema issues to 422", () => {
    const zodError = (() => {
      try {
        z.object({ a: z.number() }).parse({ a: "x" });
      } catch (e) {
        return e;
      }
    })();
    const mapped = classifyError(zodError, false);
    expect(mapped.status).toBe(422);
    expect(mapped.code).toBe("VALIDATION");
    expect((mapped.details as { issues: { path: string }[] }).issues[0]?.path).toBe("a");

    const valiError = (() => {
      try {
        v.parse(v.object({ a: v.number() }), { a: "x" });
      } catch (e) {
        return e;
      }
    })();
    expect(classifyError(valiError, false).status).toBe(422);
  });

  it("maps body-parser errors", () => {
    expect(
      classifyError(
        { type: "entity.parse.failed", status: 400, expose: true, message: "Unexpected token" },
        false,
      ),
    ).toEqual({
      status: 400,
      code: "BAD_REQUEST",
      message: "Malformed request body",
    });
    expect(
      classifyError({ type: "entity.too.large", status: 413, limit: 10, length: 20 }, false),
    ).toEqual({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body too large",
      details: { limit: 10, length: 20 },
    });
  });

  it("honours http-errors style status and expose", () => {
    expect(classifyError({ status: 404, message: "hidden" }, true)).toEqual({
      status: 404,
      code: "NOT_FOUND",
      message: "Not Found",
    });
    expect(
      classifyError({ statusCode: 401, expose: true, message: "token expired" }, false),
    ).toEqual({
      status: 401,
      code: "UNAUTHORIZED",
      message: "token expired",
    });
    expect(classifyError({ status: 418 }, false).code).toBe("IM_A_TEAPOT");
    expect(classifyError({ status: 200, message: "not an error status" }, false).status).toBe(500);
  });

  it("hides or exposes unknown errors", () => {
    expect(classifyError(new TypeError("x is undefined"), false)).toEqual({
      status: 500,
      code: "INTERNAL",
      message: "Internal Server Error",
    });
    expect(classifyError(new TypeError("x is undefined"), true)).toEqual({
      status: 500,
      code: "INTERNAL",
      message: "x is undefined",
    });
    expect(classifyError("string thrown", true).message).toBe("string thrown");
    expect(classifyError(undefined, true).message).toBe("Unknown error");
  });
});

describe("errorHandler", () => {
  it("renders the unified envelope with requestId and never the error name", async () => {
    const r = new Router();
    r.get("/nf").handle(() => {
      throw new NotFound("gone", { id: 1 });
    });
    r.get("/boom").handle(() => {
      throw new RangeError("boom");
    });
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const nf = await fetch("/nf", { headers: { "x-request-id": "r1" } });
        expect(nf.status).toBe(404);
        expect(await nf.json()).toEqual({
          code: "NOT_FOUND",
          message: "gone",
          details: { id: 1 },
          requestId: "r1",
        });
        const boom = await fetch("/boom");
        expect(boom.status).toBe(500);
        const body = await boom.json();
        expect(body).toMatchObject({
          code: "INTERNAL",
          message: "boom",
          requestId: expect.any(String),
        });
        expect(body.stack).toMatch(/RangeError: boom/);
        expect(JSON.stringify(body)).not.toContain('"name"');
      },
    );
  });

  it("hides messages and stacks when expose is false, and logs 5xx", async () => {
    const { logger, lines } = captureLogger();
    const r = new Router();
    r.get("/boom").handle(() => {
      throw new Error("secret detail");
    });
    r.get("/nf").handle(() => {
      throw new NotFound();
    });
    const server = await serve((app) => {
      app.use((req, res, next) => {
        createCtx(req, res, { logger });
        next();
      });
      app.use(r);
      app.use(errorHandler({ expose: false }));
    });
    try {
      const boom = await server.fetch("/boom");
      expect(await boom.json()).toEqual({
        code: "INTERNAL",
        message: "Internal Server Error",
        requestId: expect.any(String),
      });
      const errors = () => lines.filter((l) => l.level === LEVEL.error);
      expect(errors()).toHaveLength(1);
      expect(errors()[0]).toMatchObject({
        status: 500,
        code: "INTERNAL",
        route: "GET /boom",
        msg: "Internal Server Error",
        err: { message: "secret detail" },
      });
      await server.fetch("/nf");
      expect(errors()).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("classifies body-parser failures from express.json()", async () => {
    const r = new Router();
    r.post("/b").handle((ctx) => ctx.body);
    await withApp(
      (app) => {
        app.use(express.json({ limit: "32b" }));
        app.use(r);
      },
      async ({ fetch }) => {
        const malformed = await fetch("/b", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{not json",
        });
        expect(malformed.status).toBe(400);
        expect((await malformed.json()).message).toBe("Malformed request body");
        const big = await fetch("/b", json({ text: "x".repeat(100) }));
        expect(big.status).toBe(413);
        expect((await big.json()).code).toBe("PAYLOAD_TOO_LARGE");
      },
    );
  });

  it("supports map (MappedError or HttpError) and format", async () => {
    class DbError extends Error {
      constraint = "orders_pk";
    }
    const r = new Router();
    r.get("/db").handle(() => {
      throw new DbError("dup");
    });
    r.get("/http").handle(() => {
      throw new DbError("as-http");
    });
    r.get("/other").handle(() => {
      throw new NotFound();
    });
    const server = await serve((app) => {
      app.use(r);
      app.use(
        errorHandler({
          map: (err, ctx) => {
            if (err instanceof DbError && ctx.path === "/http") return new Forbidden("mapped http");
            if (err instanceof DbError)
              return {
                status: 409,
                code: "CONFLICT",
                message: "duplicate",
                details: { constraint: err.constraint },
              };
            return undefined;
          },
          format: (mapped, ctx) => ({
            error: mapped.code,
            why: mapped.message,
            rid: ctx.requestId,
            extra: mapped.details ?? null,
          }),
        }),
      );
    });
    try {
      const db = await server.fetch("/db");
      expect(db.status).toBe(409);
      expect(await db.json()).toEqual({
        error: "CONFLICT",
        why: "duplicate",
        rid: expect.any(String),
        extra: { constraint: "orders_pk" },
      });
      const http = await server.fetch("/http");
      expect(http.status).toBe(403);
      expect((await http.json()).why).toBe("mapped http");
      const other = await server.fetch("/other");
      expect(other.status).toBe(404);
      expect((await other.json()).error).toBe("NOT_FOUND");
    } finally {
      await server.close();
    }
  });

  it("falls back to 500 when map itself throws", async () => {
    const r = new Router();
    r.get("/x").handle(() => {
      throw new NotFound();
    });
    const server = await serve((app) => {
      app.use(r);
      app.use(
        errorHandler({
          expose: true,
          map: () => {
            throw new Error("map bug");
          },
        }),
      );
    });
    try {
      const res = await server.fetch("/x");
      expect(res.status).toBe(500);
      expect((await res.json()).message).toBe("map bug");
    } finally {
      await server.close();
    }
  });

  it("defers to Express when headers were already sent", async () => {
    const r = new Router();
    r.get("/x").handle((ctx) =>
      ctx.raw((res) => {
        res.write("partial");
        throw new Error("mid-stream");
      }),
    );
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        await expect(fetch("/x").then((res) => res.text())).rejects.toThrow();
      },
    );
  });

  it("notFound() turns unmatched requests into 404 envelopes", async () => {
    const r = new Router();
    r.get("/x").handle(() => "ok");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const res = await fetch("/missing?q=1");
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
          code: "NOT_FOUND",
          message: "No route for GET /missing",
          requestId: expect.any(String),
        });
      },
    );
  });

  it("works standalone on Express without a notio router", async () => {
    await withApp(
      (app) => {
        app.get("/plain", () => {
          throw new Forbidden("express route");
        });
      },
      async ({ fetch }) => {
        const res = await fetch("/plain");
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({
          code: "FORBIDDEN",
          message: "express route",
          requestId: expect.any(String),
        });
      },
    );
  });
});

describe("notFound()", () => {
  it("is a plain Express handler", () => {
    expect(notFound().length).toBe(3);
  });
});
