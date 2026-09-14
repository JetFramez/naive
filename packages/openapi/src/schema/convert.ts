import { createRequire } from "node:module";
import type { StandardSchemaV1 } from "@naive-internal/core";
import type { JsonSchema } from "./json-schema.js";

type Converter = (schema: StandardSchemaV1) => JsonSchema;

// None of the three conversions below are asynchronous work; the only reason
// to load Zod/Valibot's converter lazily is to keep them optional. `require`
// (via createRequire, since this package is ESM) does that synchronously:
// both ship a `require` export condition for exactly this case, so
// conversion never needs an `await`.
const require = createRequire(import.meta.url);

let zodModule: typeof import("zod") | undefined;
let valibotConverter: typeof import("@valibot/to-json-schema") | undefined;

function loadZod(): typeof import("zod") {
  if (zodModule) return zodModule;
  try {
    zodModule = require("zod");
  } catch {
    throw new Error('OpenAPI: converting a Zod schema needs "zod" installed: pnpm add zod');
  }
  return zodModule as typeof import("zod");
}

function loadValibotConverter(): typeof import("@valibot/to-json-schema") {
  if (valibotConverter) return valibotConverter;
  try {
    valibotConverter = require("@valibot/to-json-schema");
  } catch {
    throw new Error(
      'OpenAPI: converting a Valibot schema needs "@valibot/to-json-schema" installed: pnpm add @valibot/to-json-schema',
    );
  }
  return valibotConverter as typeof import("@valibot/to-json-schema");
}

function zod(schema: StandardSchemaV1): JsonSchema {
  const mod = loadZod();
  if (typeof mod.toJSONSchema !== "function") {
    throw new Error(
      "OpenAPI: converting a Zod schema needs Zod 4 or later (z.toJSONSchema is missing)",
    );
  }
  return mod.toJSONSchema(schema as never, { target: "draft-2020-12" }) as JsonSchema;
}

function valibot(schema: StandardSchemaV1): JsonSchema {
  return loadValibotConverter().toJsonSchema(schema as never) as JsonSchema;
}

function arktype(schema: StandardSchemaV1): JsonSchema {
  const withMethod = schema as unknown as { toJsonSchema?: () => JsonSchema };
  if (typeof withMethod.toJsonSchema !== "function") {
    throw new Error("OpenAPI: this ArkType version has no toJsonSchema() method; upgrade arktype");
  }
  return withMethod.toJsonSchema();
}

const CONVERTERS: Record<string, Converter> = { zod, valibot, arktype };

export interface SchemaConverters {
  readonly [vendor: string]: Converter;
}

/**
 * Converts a Standard Schema to JSON Schema, dispatching on `~standard.vendor`.
 * Zod, Valibot and ArkType are built in; register more via `openapi({ schemaConverters })`.
 */
export function convertSchema(schema: StandardSchemaV1, extra: SchemaConverters = {}): JsonSchema {
  const vendor = schema["~standard"].vendor;
  const converter = extra[vendor] ?? CONVERTERS[vendor];
  if (!converter) {
    throw new Error(
      `OpenAPI: no JSON Schema converter for "${vendor}" schemas. Built in: zod, valibot, arktype. ` +
        `Register your own with openapi({ schemaConverters: { ${vendor}: (schema) => ({...}) } }).`,
    );
  }
  return converter(schema);
}
