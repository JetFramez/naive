import type {
  StandardIssue,
  StandardResult,
  StandardSchemaProps,
  StandardSchemaV1,
} from "../schema/standard.js";
import { parseBytes } from "../util/bytes.js";
import { parseDuration } from "../util/duration.js";

/**
 * A Standard Schema leaf for configuration values. Accepts the raw string an
 * environment variable provides as well as the already-typed value, so the
 * same fragment validates env, `.env` files, overrides and inline options.
 */
export interface EnvSchema<Input, Output> extends StandardSchemaV1<Input, Output> {
  readonly "~standard": StandardSchemaProps<Input, Output> & {
    readonly kind: string;
    readonly defaultValue: Output | undefined;
    readonly optional: boolean;
  };
}

export interface LeafOptions<T> {
  default?: T | undefined;
  optional?: boolean | undefined;
}

type Parse<T> = (value: unknown) => T | StandardIssue;

const issue = (message: string): StandardIssue => ({ message });

function isIssue(value: unknown): value is StandardIssue {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    Object.keys(value).length === 1
  );
}

function leaf<Input, Output>(
  kind: string,
  parse: Parse<Output>,
  options: LeafOptions<Output> = {},
): EnvSchema<Input, Output> {
  const { default: defaultValue, optional = false } = options;
  const validate = (value: unknown): StandardResult<Output> => {
    if (value === undefined || value === "") {
      if (defaultValue !== undefined) return { value: defaultValue };
      if (optional) return { value: undefined as Output };
      return { issues: [issue("required")] };
    }
    const out = parse(value);
    return isIssue(out) ? { issues: [out] } : { value: out };
  };
  return {
    "~standard": {
      version: 1,
      vendor: "naive",
      validate,
      kind,
      defaultValue,
      optional,
      types: undefined,
    },
  };
}

type Opt<T, O extends { optional?: boolean | undefined }> = O["optional"] extends true
  ? T | undefined
  : T;

const BOOL_TRUE = new Set(["true", "1", "yes", "on"]);
const BOOL_FALSE = new Set(["false", "0", "no", "off"]);

function string<const O extends LeafOptions<string>>(
  options?: O,
): EnvSchema<string, Opt<string, O>> {
  return leaf("string", (v) => (typeof v === "string" ? v : issue("expected a string")), options);
}

function number<const O extends LeafOptions<number>>(
  options?: O,
): EnvSchema<string | number, Opt<number, O>> {
  return leaf(
    "number",
    (v) => {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
      return Number.isFinite(n) ? n : issue(`expected a number, got "${String(v)}"`);
    },
    options,
  );
}

function integer<const O extends LeafOptions<number>>(
  options?: O,
): EnvSchema<string | number, Opt<number, O>> {
  return leaf(
    "integer",
    (v) => {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
      return Number.isInteger(n) ? n : issue(`expected an integer, got "${String(v)}"`);
    },
    options,
  );
}

function port<const O extends LeafOptions<number>>(
  options?: O,
): EnvSchema<string | number, Opt<number, O>> {
  return leaf(
    "port",
    (v) => {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
      return Number.isInteger(n) && n >= 0 && n <= 65535
        ? n
        : issue(`expected a port (0-65535), got "${String(v)}"`);
    },
    options,
  );
}

function boolean<const O extends LeafOptions<boolean>>(
  options?: O,
): EnvSchema<string | boolean, Opt<boolean, O>> {
  return leaf(
    "boolean",
    (v) => {
      if (typeof v === "boolean") return v;
      const s = String(v).trim().toLowerCase();
      if (BOOL_TRUE.has(s)) return true;
      if (BOOL_FALSE.has(s)) return false;
      return issue(`expected a boolean (true/false/1/0/yes/no/on/off), got "${String(v)}"`);
    },
    options,
  );
}

/** A duration; strings such as `"30s"` become milliseconds. */
function duration<const O extends LeafOptions<number | string>>(
  options?: O,
): EnvSchema<string | number, Opt<number, O>> {
  const resolved = options?.default === undefined ? undefined : parseDuration(options.default);
  return leaf(
    "duration",
    (v) => {
      try {
        return typeof v === "string" || typeof v === "number"
          ? parseDuration(v)
          : issue("expected a duration");
      } catch (error) {
        return issue((error as Error).message);
      }
    },
    { ...options, default: resolved } as LeafOptions<number>,
  ) as EnvSchema<string | number, Opt<number, O>>;
}

/** A byte size; strings such as `"10mb"` become bytes. */
function bytes<const O extends LeafOptions<number | string>>(
  options?: O,
): EnvSchema<string | number, Opt<number, O>> {
  const resolved = options?.default === undefined ? undefined : parseBytes(options.default);
  return leaf(
    "bytes",
    (v) => {
      try {
        return typeof v === "string" || typeof v === "number"
          ? parseBytes(v)
          : issue("expected a size");
      } catch (error) {
        return issue((error as Error).message);
      }
    },
    { ...options, default: resolved } as LeafOptions<number>,
  ) as EnvSchema<string | number, Opt<number, O>>;
}

function url<const O extends LeafOptions<string>>(options?: O): EnvSchema<string, Opt<string, O>> {
  return leaf(
    "url",
    (v) => {
      if (typeof v !== "string") return issue("expected a URL");
      try {
        new URL(v);
        return v;
      } catch {
        return issue(`expected a URL, got "${v}"`);
      }
    },
    options,
  );
}

function enumeration<const V extends readonly string[], const O extends LeafOptions<V[number]>>(
  values: V,
  options?: O,
): EnvSchema<string, Opt<V[number], O>> {
  return leaf(
    "enum",
    (v) =>
      typeof v === "string" && values.includes(v)
        ? (v as V[number])
        : issue(`expected one of ${values.join(", ")}, got "${String(v)}"`),
    options,
  );
}

/** A comma-separated list; arrays pass through. Empty items are dropped. */
function list<const O extends LeafOptions<string[]>>(
  options?: O,
): EnvSchema<string | string[], Opt<string[], O>> {
  return leaf(
    "list",
    (v) => {
      if (Array.isArray(v)) return v.map(String);
      if (typeof v !== "string") return issue("expected a comma-separated list");
      return v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    },
    options,
  );
}

/**
 * Leaf schemas for configuration. Every value accepts the environment's raw
 * string and the typed value alike. Use them in `defineConfig` shapes and in
 * module option fragments; any other Standard Schema works too.
 */
export const env = {
  string,
  number,
  integer,
  port,
  boolean,
  duration,
  bytes,
  url,
  enum: enumeration,
  list,
};
