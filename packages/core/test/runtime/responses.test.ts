import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import express from "express";
import { describe, expect, it } from "vitest";
import { createCtx, Router } from "../../src/index.js";
import { withApp } from "../helpers/http.js";
import { captureLogger, LEVEL } from "../helpers/logger.js";

describe("plain return conventions", () => {
  it("sends strings as text/plain 200", async () => {
    const r = new Router();
    r.get("/t").handle(() => "hello");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const res = await fetch("/t");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
        expect(await res.text()).toBe("hello");
      },
    );
  });

  it("sends objects, arrays, numbers, booleans and null as JSON; 201 for POST", async () => {
    const r = new Router();
    r.get("/o").handle(() => ({ a: 1 }));
    r.get("/a").handle(() => [1, 2]);
    r.get("/n").handle(() => 42);
    r.get("/b").handle(() => false);
    r.get("/z").handle(() => null);
    r.post("/o").handle(() => ({ created: true }));
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        for (const [path, body] of [
          ["/o", { a: 1 }],
          ["/a", [1, 2]],
          ["/n", 42],
          ["/b", false],
          ["/z", null],
        ] as const) {
          const res = await fetch(path);
          expect(res.status).toBe(200);
          expect(res.headers.get("content-type")).toMatch(/^application\/json/);
          expect(await res.json()).toEqual(body);
        }
        const created = await fetch("/o", { method: "POST" });
        expect(created.status).toBe(201);
        expect(await created.json()).toEqual({ created: true });
      },
    );
  });

  it("sends undefined as 204", async () => {
    const r = new Router();
    r.get("/u").handle(() => undefined);
    r.delete("/u").handle(async () => {});
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect((await fetch("/u")).status).toBe(204);
        expect((await fetch("/u", { method: "DELETE" })).status).toBe(204);
      },
    );
  });

  it("sends Buffers and Readables as octet-stream unless a type was set", async () => {
    const r = new Router();
    r.get("/buf").handle(() => Buffer.from("bytes"));
    r.get("/stream").handle(() => Readable.from(["a", "b", "c"]));
    r.get("/typed").handle((ctx) => {
      ctx.set("content-type", "text/csv");
      return Readable.from(["x,y"]);
    });
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const buf = await fetch("/buf");
        expect(buf.headers.get("content-type")).toBe("application/octet-stream");
        expect(await buf.text()).toBe("bytes");
        const stream = await fetch("/stream");
        expect(stream.headers.get("content-type")).toBe("application/octet-stream");
        expect(await stream.text()).toBe("abc");
        const typed = await fetch("/typed");
        expect(typed.headers.get("content-type")).toMatch(/^text\/csv/);
      },
    );
  });

  it("applies ctx.status() and ctx.set() to plain returns", async () => {
    const r = new Router();
    r.get("/x").handle(
      (ctx) => ctx.status(202).set("x-a", "1").set("x-b", ["2", "3"]) && { ok: 1 },
    );
    r.get("/none").handle((ctx) => {
      ctx.status(418);
      return undefined;
    });
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const res = await fetch("/x");
        expect(res.status).toBe(202);
        expect(res.headers.get("x-a")).toBe("1");
        expect(res.headers.get("x-b")).toBe("2, 3");
        expect((await fetch("/none")).status).toBe(418);
      },
    );
  });

  it("does nothing when the handler already wrote to ctx.res, and warns if a value was returned", async () => {
    const { logger, lines } = captureLogger();
    const warnings = () => lines.filter((l) => l.level === LEVEL.warn);
    const r = new Router();
    r.get("/raw").handle((ctx) => {
      ctx.res.status(200).send("direct");
    });
    r.get("/both").handle((ctx) => {
      ctx.res.status(200).send("direct");
      return { ignored: true };
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
        expect(await (await fetch("/raw")).text()).toBe("direct");
        expect(warnings()).toHaveLength(0);
        expect(await (await fetch("/both")).text()).toBe("direct");
        expect(warnings()).toHaveLength(1);
        expect(warnings()[0]?.msg).toMatch(/also returned a value/);
      },
    );
  });
});

describe("descriptors", () => {
  const dir = mkdtempSync(join(tmpdir(), "naive-"));
  writeFileSync(join(dir, "hello.txt"), "file contents");

  it("json/text/redirect/empty/raw/stream", async () => {
    const r = new Router();
    r.post("/json").handle((ctx) => ctx.json({ a: 1 }, { status: 200, headers: { "x-k": "v" } }));
    r.get("/json-default").handle((ctx) => ctx.status(203).json({ a: 1 }));
    r.get("/text").handle((ctx) => ctx.text("plain", { status: 201 }));
    r.get("/redir").handle((ctx) => ctx.redirect("/elsewhere"));
    r.get("/redir301").handle((ctx) => ctx.redirect("/elsewhere", 301));
    r.get("/empty").handle((ctx) => ctx.empty());
    r.get("/empty205").handle((ctx) => ctx.empty(205));
    r.get("/raw").handle((ctx) =>
      ctx.raw((res) => {
        res.status(299).type("text/plain").send("raw");
      }),
    );
    r.get("/stream").handle((ctx) =>
      ctx.stream(Readable.from(["s1", "s2"]), { type: "text/plain", headers: { "x-s": "1" } }),
    );
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const j = await fetch("/json", { method: "POST" });
        expect(j.status).toBe(200);
        expect(j.headers.get("x-k")).toBe("v");
        expect(await j.json()).toEqual({ a: 1 });
        expect((await fetch("/json-default")).status).toBe(203);
        const t = await fetch("/text");
        expect(t.status).toBe(201);
        expect(t.headers.get("content-type")).toMatch(/^text\/plain/);
        expect(await t.text()).toBe("plain");
        const rd = await fetch("/redir");
        expect(rd.status).toBe(302);
        expect(rd.headers.get("location")).toBe("/elsewhere");
        expect((await fetch("/redir301")).status).toBe(301);
        expect((await fetch("/empty")).status).toBe(204);
        expect((await fetch("/empty205")).status).toBe(205);
        const raw = await fetch("/raw");
        expect(raw.status).toBe(299);
        expect(await raw.text()).toBe("raw");
        const s = await fetch("/stream");
        expect(s.headers.get("x-s")).toBe("1");
        expect(s.headers.get("content-type")).toMatch(/^text\/plain/);
        expect(await s.text()).toBe("s1s2");
      },
    );
  });

  it("file and download", async () => {
    const r = new Router();
    r.get("/file").handle((ctx) => ctx.file(join(dir, "hello.txt")));
    r.get("/file-typed").handle((ctx) => ctx.file(join(dir, "hello.txt"), { type: "text/csv" }));
    r.get("/dl").handle((ctx) => ctx.download(join(dir, "hello.txt"), "renamed.txt"));
    r.get("/missing").handle((ctx) => ctx.file(join(dir, "nope.txt")));
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        const f = await fetch("/file");
        expect(f.status).toBe(200);
        expect(f.headers.get("content-type")).toMatch(/^text\/plain/);
        expect(await f.text()).toBe("file contents");
        expect((await fetch("/file-typed")).headers.get("content-type")).toMatch(/^text\/csv/);
        const d = await fetch("/dl");
        expect(d.headers.get("content-disposition")).toBe('attachment; filename="renamed.txt"');
        expect((await fetch("/missing")).status).toBe(404);
      },
    );
  });
});

describe("bare Express interop", () => {
  it("works with app.use(router) and with router.express()", async () => {
    const r = new Router("/api");
    r.get("/a").handle(() => "a");
    const r2 = new Router();
    r2.get("/b").handle(() => "b");
    await withApp(
      (app) => {
        app.use(r);
        app.use("/mounted", r2.express());
      },
      async ({ fetch }) => {
        expect(await (await fetch("/api/a")).text()).toBe("a");
        expect(await (await fetch("/mounted/b")).text()).toBe("b");
      },
    );
  });

  it("serves routes registered after the first request", async () => {
    const r = new Router();
    r.get("/first").handle(() => "1");
    await withApp(
      (app) => app.use(r),
      async ({ fetch }) => {
        expect((await fetch("/first")).status).toBe(200);
        expect((await fetch("/second")).status).toBe(404);
        r.get("/second").handle(() => "2");
        expect(await (await fetch("/second")).text()).toBe("2");
      },
    );
  });

  it("is not mistaken for a sub-app by Express", () => {
    const r = new Router();
    expect(typeof r).toBe("function");
    expect((r as unknown as { set?: unknown }).set).toBeUndefined();
    expect(express().use(r)).toBeDefined();
  });
});
