import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearUploadsParser, Router, type UploadFieldsSpec } from "@naive-internal/core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { sweepTempDir } from "../src/index.js";
import { uploads } from "../src/uploads.js";
import { withApp } from "./helpers/http.js";
import {
  buildMultipart,
  field,
  file,
  GIF_BYTES,
  PNG_BYTES,
  TEXT_BYTES,
} from "./helpers/multipart.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "naive-upload-test-"));
}

async function subdirs(root: string): Promise<string[]> {
  try {
    return await readdir(root);
  } catch {
    return [];
  }
}

afterEach(() => {
  clearUploadsParser();
});

describe("uploads(): single and multiple files", () => {
  it("accepts a single declared file field, exposes UploadedFile, and validates text fields via .body()", async () => {
    const tempDir = await tempRoot();
    const router = new Router();
    router
      .post("/x")
      .body(z.object({ title: z.string() }))
      .uploads({ avatar: { types: ["image/png"] } })
      .handle((ctx) => ({
        title: ctx.body.title,
        field: ctx.uploads.avatar.field,
        filename: ctx.uploads.avatar.filename,
        mimeType: ctx.uploads.avatar.mimeType,
        size: ctx.uploads.avatar.size,
        hasPath: typeof ctx.uploads.avatar.path === "string",
      }));

    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const { body, contentType } = buildMultipart([
          field("title", "Profile picture"),
          file("avatar", "me.png", PNG_BYTES, "image/gif"), // client header is a lie; sniffing must win
        ]);
        const res = await fetch("/x", {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        });
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({
          title: "Profile picture",
          field: "avatar",
          filename: "me.png",
          mimeType: "image/png",
          size: PNG_BYTES.length,
          hasPath: true,
        });
      },
    );
  });

  it("collects an array field up to maxCount, and drops fields beyond the array without maxCount", async () => {
    const tempDir = await tempRoot();
    const router = new Router();
    router
      .post("/gallery")
      .uploads({ photo: { maxCount: 2 }, cover: {} })
      .handle((ctx) => ({
        photos: ctx.uploads.photo.map((f) => f.filename),
        cover: ctx.uploads.cover.filename,
      }));

    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const { body, contentType } = buildMultipart([
          file("photo", "a.gif", GIF_BYTES),
          file("photo", "b.gif", GIF_BYTES),
          file("cover", "c.gif", GIF_BYTES),
        ]);
        const res = await fetch("/gallery", {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        });
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ photos: ["a.gif", "b.gif"], cover: "c.gif" });
      },
    );
  });

  it("leaves an optional field undefined when absent", async () => {
    const tempDir = await tempRoot();
    const router = new Router();
    router
      .post("/opt")
      .uploads({ doc: { optional: true } })
      .handle((ctx) => ({ doc: ctx.uploads.doc ?? null }));
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const { body, contentType } = buildMultipart([field("noop", "1")]);
        const res = await fetch("/opt", {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        });
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ doc: null });
      },
    );
  });
});

describe("uploads(): validation issues", () => {
  function setup(spec: UploadFieldsSpec): Router {
    const router = new Router();
    router
      .post("/x")
      .uploads(spec)
      .handle(() => "ok");
    return router;
  }

  it("reports FILE_REQUIRED when a required field is missing", async () => {
    const tempDir = await tempRoot();
    const router = setup({ avatar: {} });
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const { body, contentType } = buildMultipart([field("noop", "1")]);
        const res = await fetch("/x", {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        });
        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.code).toBe("VALIDATION");
        expect(json.details.in).toBe("uploads");
        expect(json.details.issues).toEqual([
          {
            path: "avatar",
            code: "FILE_REQUIRED",
            message: 'Field "avatar" is required',
            meta: expect.any(Object),
          },
        ]);
      },
    );
  });

  it("reports UNEXPECTED_FILE for a file field not in the spec, without failing declared fields silently", async () => {
    const tempDir = await tempRoot();
    const router = setup({ avatar: {} });
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const { body, contentType } = buildMultipart([
          file("avatar", "a.gif", GIF_BYTES),
          file("extra", "b.gif", GIF_BYTES),
        ]);
        const res = await fetch("/x", {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        });
        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.details.issues).toEqual([
          {
            path: "extra",
            code: "UNEXPECTED_FILE",
            message: 'Unexpected file field "extra"',
            meta: expect.any(Object),
          },
        ]);
      },
    );
  });

  it("reports TOO_MANY_FILES beyond a field's maxCount (default 1)", async () => {
    const tempDir = await tempRoot();
    const router = setup({ avatar: {} });
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const { body, contentType } = buildMultipart([
          file("avatar", "a.gif", GIF_BYTES),
          file("avatar", "b.gif", GIF_BYTES),
        ]);
        const res = await fetch("/x", {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        });
        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.details.issues).toEqual([
          {
            path: "avatar",
            code: "TOO_MANY_FILES",
            message: 'Field "avatar" accepts at most 1 file',
            meta: expect.any(Object),
          },
        ]);
      },
    );
  });

  it("reports FILE_TOO_LARGE and deletes the partial file from disk", async () => {
    const tempDir = await tempRoot();
    const router = setup({ avatar: { maxSize: 10 } });
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const { body, contentType } = buildMultipart([file("avatar", "a.gif", GIF_BYTES)]);
        const res = await fetch("/x", {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        });
        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.details.issues[0]).toMatchObject({ path: "avatar", code: "FILE_TOO_LARGE" });
        await new Promise((r) => setTimeout(r, 20));
        expect(await subdirs(tempDir)).toEqual([]);
      },
    );
  });

  it("reports FILE_TYPE_NOT_ALLOWED using content sniffing, not the client's Content-Type header", async () => {
    const tempDir = await tempRoot();
    const router = setup({ avatar: { types: ["image/png"] } });
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        // client claims image/png, content is actually plain text
        const { body, contentType } = buildMultipart([
          file("avatar", "a.txt", TEXT_BYTES, "image/png"),
        ]);
        const res = await fetch("/x", {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        });
        expect(res.status).toBe(422);
        expect((await res.json()).details.issues[0]).toMatchObject({
          path: "avatar",
          code: "FILE_TYPE_NOT_ALLOWED",
        });
      },
    );
  });

  it("supports wildcard types like image/*", async () => {
    const tempDir = await tempRoot();
    const router = setup({ avatar: { types: ["image/*"] } });
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        for (const content of [PNG_BYTES, GIF_BYTES]) {
          const { body, contentType } = buildMultipart([file("avatar", "a.bin", content)]);
          const res = await fetch("/x", {
            method: "POST",
            headers: { "content-type": contentType },
            body,
          });
          expect(res.status).toBe(200); // handler returns the string "ok"
        }
        const { body, contentType } = buildMultipart([file("avatar", "a.txt", TEXT_BYTES)]);
        const res = await fetch("/x", {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        });
        expect(res.status).toBe(422);
      },
    );
  });

  it("reports TOTAL_SIZE_EXCEEDED once, across fields, ignoring other issues", async () => {
    const tempDir = await tempRoot();
    const router = new Router();
    router
      .post("/x")
      .uploads({ a: { maxSize: "1mb" }, b: { maxSize: "1mb" } })
      .handle(() => "ok");
    await withApp(
      (app) => {
        app.use(uploads({ tempDir, maxTotalSize: GIF_BYTES.length + 5 }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const { body, contentType } = buildMultipart([
          file("a", "a.gif", GIF_BYTES),
          file("b", "b.gif", GIF_BYTES),
        ]);
        const res = await fetch("/x", {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        });
        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.details.issues).toHaveLength(1);
        expect(json.details.issues[0].code).toBe("TOTAL_SIZE_EXCEEDED");
      },
    );
  });

  it("collects multiple issues from different fields together", async () => {
    const tempDir = await tempRoot();
    const router = new Router();
    router
      .post("/x")
      .uploads({ a: { maxSize: 5 }, b: {} })
      .handle(() => "ok");
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const { body, contentType } = buildMultipart([file("a", "a.gif", GIF_BYTES)]);
        const res = await fetch("/x", {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        });
        expect(res.status).toBe(422);
        const codes = (await res.json()).details.issues.map((i: { code: string }) => i.code).sort();
        expect(codes).toEqual(["FILE_REQUIRED", "FILE_TOO_LARGE"]);
      },
    );
  });

  it("rejects a non-multipart request with 400", async () => {
    const tempDir = await tempRoot();
    const router = new Router();
    router
      .post("/x")
      .uploads({ a: {} })
      .handle(() => "ok");
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const res = await fetch("/x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        expect(res.status).toBe(400);
      },
    );
  });
});

describe("precedence: field over global for limits and messages", () => {
  it("a field's own maxSize and types override the global defaults", async () => {
    const tempDir = await tempRoot();
    const router = new Router();
    router
      .post("/x")
      .uploads({ small: { maxSize: 5 }, big: {} })
      .handle(() => "ok");
    await withApp(
      (app) => {
        app.use(uploads({ tempDir, maxFileSize: "1mb" }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const rejected = await fetch("/x", {
          method: "POST",
          ...buildMultipartInit([
            file("small", "s.gif", GIF_BYTES),
            file("big", "b.gif", GIF_BYTES),
          ]),
        });
        expect(rejected.status).toBe(422);
        const issues = (await rejected.json()).details.issues;
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ path: "small", code: "FILE_TOO_LARGE" });
      },
    );
  });

  it("resolves messages: field message > global message > built-in default", async () => {
    const tempDir = await tempRoot();
    const router = new Router();
    router
      .post("/x")
      .uploads({
        a: { maxSize: 5, messages: { FILE_TOO_LARGE: "field says too big" } },
        b: { maxSize: 5 },
        c: {},
      })
      .handle(() => "ok");
    await withApp(
      (app) => {
        app.use(uploads({ tempDir, messages: { FILE_TOO_LARGE: (m) => `global: ${m.field}` } }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const res = await fetch("/x", {
          method: "POST",
          ...buildMultipartInit([file("a", "a.gif", GIF_BYTES), file("b", "b.gif", GIF_BYTES)]),
        });
        const issues: Array<{ path: string; message: string }> = (await res.json()).details.issues;
        const byPath = Object.fromEntries(issues.map((i) => [i.path, i.message]));
        expect(byPath.a).toBe("field says too big");
        expect(byPath.b).toBe("global: b");
        expect(byPath.c).toBe('Field "c" is required');
      },
    );
  });
});

describe("UploadedFile: move, keep, discard, and request cleanup", () => {
  it("deletes the temp file after the response unless moved or kept", async () => {
    const tempDir = await tempRoot();
    let seenPath = "";
    const router = new Router();
    router
      .post("/plain")
      .uploads({ f: {} })
      .handle((ctx) => {
        seenPath = ctx.uploads.f.path ?? "";
        return "ok";
      });
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        await fetch("/plain", {
          method: "POST",
          ...buildMultipartInit([file("f", "a.gif", GIF_BYTES)]),
        });
        await new Promise((r) => setTimeout(r, 30));
        expect(seenPath).not.toBe("");
        expect(existsSync(seenPath)).toBe(false);
        expect(await subdirs(tempDir)).toEqual([]);
      },
    );
  });

  it("keep() leaves the file in the temp dir", async () => {
    const tempDir = await tempRoot();
    let seenPath = "";
    const router = new Router();
    router
      .post("/keep")
      .uploads({ f: {} })
      .handle((ctx) => {
        ctx.uploads.f.keep();
        seenPath = ctx.uploads.f.path ?? "";
        return "ok";
      });
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        await fetch("/keep", {
          method: "POST",
          ...buildMultipartInit([file("f", "a.gif", GIF_BYTES)]),
        });
        await new Promise((r) => setTimeout(r, 30));
        expect(existsSync(seenPath)).toBe(true);
        expect(await readFile(seenPath)).toEqual(GIF_BYTES);
      },
    );
  });

  it("move() relocates the file and cleanup does not delete it", async () => {
    const tempDir = await tempRoot();
    const destDir = await tempRoot();
    const dest = join(destDir, "final.gif");
    const router = new Router();
    router
      .post("/move")
      .uploads({ f: {} })
      .handle(async (ctx) => {
        const moved = await ctx.uploads.f.move(dest);
        return { moved };
      });
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const res = await fetch("/move", {
          method: "POST",
          ...buildMultipartInit([file("f", "a.gif", GIF_BYTES)]),
        });
        expect(await res.json()).toEqual({ moved: dest });
        await new Promise((r) => setTimeout(r, 30));
        expect(existsSync(dest)).toBe(true);
        expect(await readFile(dest)).toEqual(GIF_BYTES);
        expect(await subdirs(tempDir)).toEqual([]);
      },
    );
  });

  it("discard() deletes the file immediately", async () => {
    const tempDir = await tempRoot();
    const router = new Router();
    router
      .post("/discard")
      .uploads({ f: {} })
      .handle(async (ctx) => {
        const path = ctx.uploads.f.path;
        await ctx.uploads.f.discard();
        return { existed: path !== undefined, deleted: path ? !existsSync(path) : null };
      });
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const res = await fetch("/discard", {
          method: "POST",
          ...buildMultipartInit([file("f", "a.gif", GIF_BYTES)]),
        });
        expect(await res.json()).toEqual({ existed: true, deleted: true });
      },
    );
  });

  it("cleans up on an error path too: a later validation failure still removes an earlier accepted file", async () => {
    const tempDir = await tempRoot();
    const router = new Router();
    router
      .post("/mixed")
      .uploads({ ok: {}, missing: {} })
      .handle(() => "unreachable");
    await withApp(
      (app) => {
        app.use(uploads({ tempDir }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const res = await fetch("/mixed", {
          method: "POST",
          ...buildMultipartInit([file("ok", "a.gif", GIF_BYTES)]),
        });
        expect(res.status).toBe(422);
        await new Promise((r) => setTimeout(r, 30));
        expect(await subdirs(tempDir)).toEqual([]);
      },
    );
  });
});

describe("memoryThreshold", () => {
  it("keeps small files in memory (no disk path) when under the threshold", async () => {
    const tempDir = await tempRoot();
    const router = new Router();
    router
      .post("/mem")
      .uploads({ f: {} })
      .handle((ctx) => ({
        hasPath: ctx.uploads.f.path !== undefined,
        hasBuffer: ctx.uploads.f.buffer !== undefined,
      }));
    await withApp(
      (app) => {
        app.use(uploads({ tempDir, memoryThreshold: "1mb" }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const res = await fetch("/mem", {
          method: "POST",
          ...buildMultipartInit([file("f", "a.gif", GIF_BYTES)]),
        });
        expect(await res.json()).toEqual({ hasPath: false, hasBuffer: true });
        await new Promise((r) => setTimeout(r, 20));
        expect(await subdirs(tempDir)).toEqual([]);
      },
    );
  });

  it("spills to disk once the buffered content exceeds the threshold", async () => {
    const tempDir = await tempRoot();
    const router = new Router();
    router
      .post("/spill")
      .uploads({ f: {} })
      .handle((ctx) => ({
        hasPath: ctx.uploads.f.path !== undefined,
        size: ctx.uploads.f.size,
      }));
    await withApp(
      (app) => {
        app.use(uploads({ tempDir, memoryThreshold: 4 }));
        app.mount(router);
      },
      async ({ fetch }) => {
        const res = await fetch("/spill", {
          method: "POST",
          ...buildMultipartInit([file("f", "a.gif", GIF_BYTES)]),
        });
        expect(await res.json()).toEqual({ hasPath: true, size: GIF_BYTES.length });
      },
    );
  });
});

describe("module installation and startup failure", () => {
  it("fails at listen() with an install message when a route declares .uploads() but the module was never registered", async () => {
    const router = new Router();
    router
      .post("/x")
      .uploads({ f: {} })
      .handle(() => "unreachable");
    const { createApp } = await import("@naive-internal/core");
    const app = createApp({ shutdown: { signals: false } });
    app.mount(router);
    await expect(app.listen(0, "127.0.0.1")).rejects.toThrow(/upload module is not installed/);
  });

  it("registers as soon as uploads() is called, before any request arrives", async () => {
    const tempDir = await tempRoot();
    const router = new Router();
    router
      .post("/x")
      .uploads({ f: {} })
      .handle(() => "ok");
    uploads({ tempDir }); // registration is a side effect of calling the factory
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const res = await fetch("/x", {
          method: "POST",
          ...buildMultipartInit([file("f", "a.gif", GIF_BYTES)]),
        });
        expect(res.status).toBe(200); // handler returns the string "ok"
      },
    );
  });
});

describe("sweepTempDir", () => {
  it("removes directories older than maxAgeMs and leaves recent ones", async () => {
    const root = await tempRoot();
    const old = join(root, "old-request");
    const recent = join(root, "recent-request");
    await mkdir(old);
    await mkdir(recent);
    const past = Date.now() - 10_000;
    await import("node:fs/promises").then((fs) => fs.utimes(old, past / 1000, past / 1000));
    await sweepTempDir(root, 1_000, {
      warn: () => {},
    } as never);
    expect((await subdirs(root)).sort()).toEqual(["recent-request"]);
  });

  it("is a no-op when the directory does not exist", async () => {
    await expect(
      sweepTempDir(join(tmpdir(), "naive-does-not-exist"), 1000, { warn: () => {} } as never),
    ).resolves.toBeUndefined();
  });

  it("uploads() triggers a sweep of stale request directories on installation", async () => {
    const tempDir = await tempRoot();
    const stale = join(tempDir, "stale-request");
    await mkdir(stale);
    const past = Date.now() - 10_000;
    await stat(stale); // ensure it exists before backdating
    await import("node:fs/promises").then((fs) => fs.utimes(stale, past / 1000, past / 1000));
    uploads({ tempDir, sweepAfter: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(await subdirs(tempDir)).toEqual([]);
  });
});

function buildMultipartInit(parts: Parameters<typeof buildMultipart>[0]) {
  const { body, contentType } = buildMultipart(parts);
  return { headers: { "content-type": contentType }, body };
}
