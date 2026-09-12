import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseDotenv } from "dotenv";
import type { InferInput, InferOutput, StandardSchemaV1 } from "../schema/standard.js";
import type { Simplify } from "../types.js";

/** Nested plain objects whose leaves are Standard Schemas. */
export interface ConfigShape {
  readonly [key: string]: StandardSchemaV1 | ConfigShape;
}

/** The typed, resolved configuration for a shape. */
export type InferConfig<S> = Simplify<{
  readonly [K in keyof S]: S[K] extends StandardSchemaV1
    ? InferOutput<S[K]>
    : S[K] extends ConfigShape
      ? InferConfig<S[K]>
      : never;
}>;

/** What a shape accepts as input: every leaf optional, raw or typed values. */
export type InferConfigInput<S> = Simplify<{
  readonly [K in keyof S]?: S[K] extends StandardSchemaV1
    ? InferInput<S[K]> | undefined
    : S[K] extends ConfigShape
      ? InferConfigInput<S[K]> | undefined
      : never;
}>;

export interface ConfigIssue {
  /** Dotted path in the shape, e.g. `"database.url"`. */
  readonly path: string;
  /** Environment variable consulted, when resolving from the environment. */
  readonly env?: string;
  readonly message: string;
}

/** Thrown at boot with every configuration problem listed. */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[], heading = "Invalid configuration") {
    const lines = issues.map((i) => `  - ${i.path}${i.env ? ` (${i.env})` : ""}: ${i.message}`);
    super(`${heading}:\n${lines.join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export interface DefineConfigOptions<S extends ConfigShape> {
  /** Environment name for `.env.<env>` files. Defaults to `NODE_ENV`, then `"development"`. */
  env?: string | undefined;
  /** Directory holding the `.env` files. Defaults to `process.cwd()`. */
  cwd?: string | undefined;
  /** Read `.env` files. Defaults to `true` outside production. */
  files?: boolean | undefined;
  /** Environment variables to read. Defaults to `process.env`. */
  processEnv?: NodeJS.ProcessEnv | undefined;
  /** Highest-precedence values, typically for tests. Validated like any other source. */
  overrides?: InferConfigInput<S> | undefined;
}

export type Config<S extends ConfigShape> = InferConfig<S> & {
  /** A copy for logging, with values under keys matching `/secret|password|token|key/i` redacted. */
  readonly $print: () => unknown;
};

const REDACT_KEY = /secret|password|token|key/i;

export function isSchema(value: unknown): value is StandardSchemaV1 {
  return typeof value === "object" && value !== null && "~standard" in value;
}

/** `database.url` → `DATABASE_URL`, `upload.maxFileSize` → `UPLOAD_MAX_FILE_SIZE`. */
export function envName(path: readonly string[]): string {
  return path
    .map((segment) =>
      segment
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[^A-Za-z0-9]+/g, "_")
        .toUpperCase(),
    )
    .join("_");
}

function getPath(source: unknown, path: readonly string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

function redact(value: unknown, key?: string): unknown {
  if (key !== undefined && REDACT_KEY.test(key) && value !== undefined && value !== null) {
    return "[Redacted]";
  }
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  return value;
}

type Lookup = (path: readonly string[]) => { value: unknown; env?: string };

/**
 * Walks a shape, resolving every leaf through `lookup` and validating it.
 * Returns the resolved object or throws {@link ConfigError} listing every problem.
 */
function resolveShape(
  shape: ConfigShape,
  lookup: Lookup,
  heading: string,
): Record<string, unknown> {
  const issues: ConfigIssue[] = [];
  const walk = (node: ConfigShape, path: string[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(node)) {
      const here = [...path, key];
      if (isSchema(entry)) {
        const { value, env } = lookup(here);
        const result = entry["~standard"].validate(value);
        if (result instanceof Promise) {
          issues.push({
            path: here.join("."),
            message: "async schemas are not supported in config",
          });
          continue;
        }
        if (result.issues) {
          for (const issue of result.issues) {
            const suffix = issue.path?.length
              ? ` (${issue.path.map((p) => String(typeof p === "object" ? p.key : p)).join(".")})`
              : "";
            issues.push({
              path: here.join("."),
              ...(env === undefined ? {} : { env }),
              message: `${issue.message}${suffix}`,
            });
          }
        } else {
          out[key] = result.value;
        }
      } else {
        out[key] = walk(entry, here);
      }
    }
    return out;
  };
  const resolved = walk(shape, []);
  if (issues.length > 0) throw new ConfigError(issues, heading);
  return resolved;
}

/**
 * Applies a shape to a plain object of values: defaults filled in, every
 * problem reported together. Module factories use it so that
 * `uploads()`, `uploads({ maxFileSize: "50mb" })` and `uploads(config.upload)`
 * are all valid.
 */
export function resolveConfig<S extends ConfigShape>(
  shape: S,
  values: InferConfigInput<S> | undefined,
  name = "options",
): InferConfig<S> {
  return resolveShape(
    shape,
    (path) => ({ value: getPath(values, path) }),
    `Invalid ${name}`,
  ) as InferConfig<S>;
}

function loadFiles(cwd: string, envName: string): Record<string, string> {
  // Lowest precedence first; later files override earlier ones.
  const names = [".env", `.env.${envName}`, ".env.local", `.env.${envName}.local`];
  let merged: Record<string, string> = {};
  for (const name of names) {
    const file = resolve(cwd, name);
    if (!existsSync(file)) continue;
    merged = { ...merged, ...parseDotenv(readFileSync(file, "utf8")) };
  }
  return merged;
}

/**
 * Resolves configuration at boot from, in order of precedence: `overrides`,
 * process env, `.env.<env>.local`, `.env.local`, `.env.<env>`, `.env`, then
 * schema defaults. `.env` files are read only outside production. Env
 * variable names follow the path: `database.url` → `DATABASE_URL`.
 *
 * Every problem is reported in one {@link ConfigError}. The result is frozen.
 */
export function defineConfig<S extends ConfigShape>(
  shape: S,
  options: DefineConfigOptions<S> = {},
): Config<S> {
  const processEnv = options.processEnv ?? process.env;
  const envLabel = options.env ?? processEnv.NODE_ENV ?? "development";
  const readFiles = options.files ?? envLabel !== "production";
  const files = readFiles ? loadFiles(options.cwd ?? process.cwd(), envLabel) : {};
  const overrides = options.overrides;

  const resolved = resolveShape(
    shape,
    (path) => {
      const override = getPath(overrides, path);
      if (override !== undefined) return { value: override };
      const name = envName(path);
      const fromEnv = processEnv[name];
      if (fromEnv !== undefined) return { value: fromEnv, env: name };
      return { value: files[name], env: name };
    },
    "Invalid configuration",
  );

  Object.defineProperty(resolved, "$print", {
    value: () => redact(structuredClone(resolved)),
    enumerable: false,
  });
  return deepFreeze(resolved) as Config<S>;
}
