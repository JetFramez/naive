import { describe, expect, it } from "vitest";
import {
  configureLogger,
  createCtx,
  createLogger,
  DEFAULT_REDACT,
  getRootLogger,
  log,
  Router,
  runWithCtx,
} from "../../src/index.js";
import { withApp } from "../helpers/http.js";
import { captureLogger, LEVEL } from "../helpers/logger.js";

describe("createLogger", () => {
  it("filters by level and supports children and isLevelEnabled", () => {
    const { logger, lines } = captureLogger("info");
    logger.debug("hidden");
    logger.info({ a: 1 }, "shown");
    const child = logger.child({ requestId: "r1" });
    child.warn("child line");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ level: LEVEL.info, a: 1, msg: "shown" });
    expect(lines[1]).toMatchObject({ level: LEVEL.warn, requestId: "r1", msg: "child line" });
    expect(logger.isLevelEnabled("debug")).toBe(false);
    expect(logger.level).toBe("info");
    logger.level = "trace";
    expect(logger.isLevelEnabled("trace")).toBe(true);
  });

  it("redacts sensitive keys by default", () => {
    const { logger, lines } = captureLogger();
    logger.info({
      authorization: "Bearer x",
      password: "pw",
      headers: { cookie: "sid=1", "set-cookie": "a=b", authorization: "Basic y" },
      user: { password: "pw2", token: "t" },
      safe: "ok",
    });
    expect(lines[0]).toMatchObject({
      authorization: "[Redacted]",
      password: "[Redacted]",
      headers: { cookie: "[Redacted]", "set-cookie": "[Redacted]", authorization: "[Redacted]" },
      user: { password: "[Redacted]", token: "[Redacted]" },
      safe: "ok",
    });
    expect(DEFAULT_REDACT).toContain("*.token");
  });

  it("reads LOG_LEVEL and rejects invalid levels at creation", () => {
    const previous = process.env.LOG_LEVEL;
    try {
      process.env.LOG_LEVEL = "warn";
      expect(createLogger({ pretty: false }).level).toBe("warn");
      process.env.LOG_LEVEL = "loud";
      expect(() => createLogger({ pretty: false })).toThrow(/Invalid log level "loud"/);
    } finally {
      if (previous === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = previous;
    }
    expect(() => createLogger({ level: "nope" as never, pretty: false })).toThrow();
  });
});

describe("log proxy", () => {
  it("uses the root logger outside requests and ctx.log inside", async () => {
    const { logger: root, lines } = captureLogger();
    configureLogger; // keep import used for the API surface
    const previousRoot = getRootLogger();
    const { setRootLogger } = await import("../../src/logger/root.js");
    setRootLogger(root);
    try {
      log.info("outside");
      expect(lines.at(-1)).toMatchObject({ msg: "outside" });
      expect(lines.at(-1)).not.toHaveProperty("requestId");

      runWithCtx({ requestId: "job-1", kind: "job" }, () => {
        log.warn("in job");
      });
      expect(lines.at(-1)).toMatchObject({ msg: "in job", requestId: "job-1", kind: "job" });

      const r = new Router("/orders");
      r.get("/:id").handle((ctx) => {
        ctx.bind({ orderId: ctx.params.id });
        log.info("in request");
        return "ok";
      });
      await withApp(
        (app) => app.use(r),
        async ({ fetch }) => {
          await fetch("/orders/5", { headers: { "x-request-id": "req-5" } });
        },
      );
      const line = lines.find((l) => l.msg === "in request");
      expect(line).toMatchObject({ requestId: "req-5", route: "GET /orders/:id", orderId: "5" });
    } finally {
      setRootLogger(previousRoot);
    }
  });

  it("uses the logger given to createCtx", async () => {
    const { logger, lines } = captureLogger();
    const r = new Router();
    r.get("/x").handle(() => {
      log.info("hello");
      return "ok";
    });
    await withApp(
      (app) => {
        app.use((req, res, next) => {
          createCtx(req, res, { logger });
          next();
        });
        app.use(r);
      },
      async ({ fetch }) => {
        await fetch("/x");
        expect(lines.some((l) => l.msg === "hello" && l.route === "GET /x")).toBe(true);
      },
    );
  });
});
