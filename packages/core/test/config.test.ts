import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ConfigError,
  defineConfig,
  env,
  envName,
  parseBytes,
  resolveConfig,
} from "../src/index.js";

describe("env leaf schemas", () => {
  const ok = <T>(
    schema: { "~standard": { validate: (v: unknown) => unknown } },
    value: unknown,
  ): T => (schema["~standard"].validate(value) as { value: T }).value;
  const bad = (
    schema: { "~standard": { validate: (v: unknown) => unknown } },
    value: unknown,
  ): string =>
    (schema["~standard"].validate(value) as { issues: { message: string }[] }).issues[0]?.message ??
    "";

  it("coerces strings and passes typed values through", () => {
    expect(ok(env.number(), "42")).toBe(42);
    expect(ok(env.number(), 4.5)).toBe(4.5);
    expect(bad(env.number(), "x")).toMatch(/expected a number/);
    expect(ok(env.integer(), "7")).toBe(7);
    expect(bad(env.integer(), "7.5")).toMatch(/integer/);
    expect(ok(env.port(), "8080")).toBe(8080);
    expect(bad(env.port(), "70000")).toMatch(/port/);
    for (const t of ["true", "1", "yes", "on", true]) expect(ok(env.boolean(), t)).toBe(true);
    for (const f of ["false", "0", "no", "off", false]) expect(ok(env.boolean(), f)).toBe(false);
    expect(bad(env.boolean(), "maybe")).toMatch(/boolean/);
    expect(ok(env.duration(), "5m")).toBe(300_000);
    expect(ok(env.duration(), 10)).toBe(10);
    expect(bad(env.duration(), "soon")).toMatch(/Invalid duration/);
    expect(ok(env.bytes(), "10mb")).toBe(10 * 1024 * 1024);
    expect(ok(env.url(), "https://x.dev/a")).toBe("https://x.dev/a");
    expect(bad(env.url(), "nope")).toMatch(/URL/);
    expect(ok(env.enum(["a", "b"]), "b")).toBe("b");
    expect(bad(env.enum(["a", "b"]), "c")).toMatch(/one of a, b/);
    expect(ok(env.list(), "a, b,,c")).toEqual(["a", "b", "c"]);
    expect(ok(env.list(), ["x"])).toEqual(["x"]);
    expect(ok(env.string(), "s")).toBe("s");
  });

  it("applies defaults and optionality on undefined and empty strings", () => {
    expect(ok(env.string({ default: "d" }), undefined)).toBe("d");
    expect(ok(env.string({ default: "d" }), "")).toBe("d");
    expect(ok(env.duration({ default: "1h" }), undefined)).toBe(3_600_000);
    expect(ok(env.bytes({ default: "1kb" }), undefined)).toBe(1024);
    expect(ok(env.string({ optional: true }), undefined)).toBeUndefined();
    expect(bad(env.string(), undefined)).toBe("required");
  });
});

describe("envName", () => {
  it("maps paths to SCREAMING_SNAKE", () => {
    expect(envName(["database", "url"])).toBe("DATABASE_URL");
    expect(envName(["upload", "maxFileSize"])).toBe("UPLOAD_MAX_FILE_SIZE");
    expect(envName(["port"])).toBe("PORT");
    expect(envName(["s3", "bucketName"])).toBe("S3_BUCKET_NAME");
  });
});

describe("parseBytes", () => {
  it("parses units", () => {
    expect(parseBytes("1kb")).toBe(1024);
    expect(parseBytes("1.5gb")).toBe(1.5 * 1024 ** 3);
    expect(parseBytes("512")).toBe(512);
    expect(parseBytes(10)).toBe(10);
    expect(() => parseBytes("big")).toThrow(/Invalid size/);
  });
});

describe("defineConfig", () => {
  const shape = {
    port: env.port({ default: 3000 }),
    database: { url: env.url(), poolSize: env.integer({ default: 5 }) },
    auth: { secret: env.string(), sessionTtl: env.duration({ default: "30d" }) },
    debug: env.boolean({ default: false }),
    zodLeaf: z.coerce.number().default(1),
  };

  it("reads process env by path convention and applies defaults", () => {
    const config = defineConfig(shape, {
      processEnv: {
        DATABASE_URL: "postgres://db/x",
        AUTH_SECRET: "s3",
        PORT: "4000",
        DEBUG: "yes",
        ZOD_LEAF: "9",
      },
      files: false,
    });
    expect(config).toEqual({
      port: 4000,
      database: { url: "postgres://db/x", poolSize: 5 },
      auth: { secret: "s3", sessionTtl: 2_592_000_000 },
      debug: true,
      zodLeaf: 9,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
    expect(config.$print()).toEqual({
      port: 4000,
      database: { url: "postgres://db/x", poolSize: 5 },
      auth: { secret: "[Redacted]", sessionTtl: 2_592_000_000 },
      debug: true,
      zodLeaf: 9,
    });
    expect(Object.keys(config)).not.toContain("$print");
  });

  it("reports every problem together with the env var name", () => {
    expect(() =>
      defineConfig(shape, { processEnv: { PORT: "abc", DATABASE_URL: "nope" }, files: false }),
    ).toThrow(ConfigError);
    try {
      defineConfig(shape, { processEnv: { PORT: "abc", DATABASE_URL: "nope" }, files: false });
    } catch (error) {
      const e = error as ConfigError;
      expect(e.issues.map((i) => `${i.path}|${i.env}`)).toEqual([
        "port|PORT",
        "database.url|DATABASE_URL",
        "auth.secret|AUTH_SECRET",
      ]);
      expect(e.message).toContain("auth.secret (AUTH_SECRET): required");
      expect(e.message).toContain("port (PORT): expected a port");
    }
  });

  it("follows dotenv precedence and skips files in production", () => {
    const dir = mkdtempSync(join(tmpdir(), "notio-config-"));
    writeFileSync(
      join(dir, ".env"),
      "PORT=1\nDATABASE_URL=postgres://env\nAUTH_SECRET=base\nONLY_BASE=1\n",
    );
    writeFileSync(join(dir, ".env.test"), "PORT=2\n");
    writeFileSync(join(dir, ".env.local"), "PORT=3\nAUTH_SECRET=local\n");
    writeFileSync(join(dir, ".env.test.local"), "PORT=4\n");
    const base = { port: env.port(), database: { url: env.url() }, auth: { secret: env.string() } };

    const test = defineConfig(base, { cwd: dir, env: "test", processEnv: {} });
    expect(test).toEqual({
      port: 4,
      database: { url: "postgres://env" },
      auth: { secret: "local" },
    });

    const dev = defineConfig(base, { cwd: dir, env: "development", processEnv: {} });
    expect(dev.port).toBe(3);

    const fromProcess = defineConfig(base, { cwd: dir, env: "test", processEnv: { PORT: "9" } });
    expect(fromProcess.port).toBe(9);

    expect(() => defineConfig(base, { cwd: dir, env: "production", processEnv: {} })).toThrow(
      ConfigError,
    );
    const prod = defineConfig(base, {
      cwd: dir,
      processEnv: {
        NODE_ENV: "production",
        PORT: "5",
        DATABASE_URL: "postgres://p",
        AUTH_SECRET: "p",
      },
    });
    expect(prod.port).toBe(5);
  });

  it("overrides win over everything and are validated", () => {
    const base = { port: env.port({ default: 1 }), auth: { secret: env.string() } };
    const config = defineConfig(base, {
      processEnv: { PORT: "2", AUTH_SECRET: "env" },
      files: false,
      overrides: { port: 3, auth: { secret: "override" } },
    });
    expect(config).toEqual({ port: 3, auth: { secret: "override" } });
    expect(() =>
      defineConfig(base, {
        processEnv: { AUTH_SECRET: "x" },
        files: false,
        overrides: { port: "high" as never },
      }),
    ).toThrow(/port: expected a port/);
  });
});

describe("resolveConfig (module fragments)", () => {
  const uploadConfig = {
    maxFileSize: env.bytes({ default: "10mb" }),
    tempDir: env.string({ optional: true }),
    sweepAfter: env.duration({ default: "1h" }),
  };

  it("accepts nothing, a partial, or a full config object", () => {
    expect(resolveConfig(uploadConfig, undefined)).toEqual({
      maxFileSize: 10 * 1024 ** 2,
      tempDir: undefined,
      sweepAfter: 3_600_000,
    });
    expect(resolveConfig(uploadConfig, { maxFileSize: "50mb" }).maxFileSize).toBe(50 * 1024 ** 2);
    const full = defineConfig(
      { upload: uploadConfig },
      { processEnv: { UPLOAD_TEMP_DIR: "/tmp/u" }, files: false },
    );
    expect(resolveConfig(uploadConfig, full.upload)).toEqual(full.upload);
    expect(resolveConfig(uploadConfig, { ...full.upload, sweepAfter: "2h" }).sweepAfter).toBe(
      7_200_000,
    );
  });

  it("names the module in errors", () => {
    expect(() => resolveConfig(uploadConfig, { maxFileSize: "huge" }, "uploads()")).toThrow(
      /Invalid uploads\(\):\n {2}- maxFileSize: Invalid size/,
    );
  });
});
