import type { StandardSchemaV1 } from "@notio-internal/core";
import type { JsonSchema } from "./json-schema.js";

type Converter = (schema: StandardSchemaV1) => Promise<JsonSchema>;

let zodModule: typeof import("zod") | undefined;
let valibotConverter: typeof import("@valibot/to-json-schema") | undefined;

async function zod(schema: StandardSchemaV1): Promise<JsonSchema> {
  zodModule ??= await import("zod").catch(() => {
    throw new Error('OpenAPI: converting a Zod schema needs "zod" installed: pnpm add zod');
  });
  if (typeof zodModule.toJSONSchema !== "function") {
    throw new Error(
      "OpenAPI: converting a Zod schema needs Zod 4 or later (z.toJSONSchema is missing)",
    );
  }
  return zodModule.toJSONSchema(schema as never, { target: "draft-2020-12" }) as JsonSchema;
}

async function valibot(schema: StandardSchemaV1): Promise<JsonSchema> {
  valibotConverter ??= await import("@valibot/to-json-schema").catch(() => {
    throw new Error(
      'OpenAPI: converting a Valibot schema needs "@valibot/to-json-schema" installed: pnpm add @valibot/to-json-schema',
    );
  });
  return valibotConverter.toJsonSchema(schema as never) as JsonSchema;
}

async function arktype(schema: StandardSchemaV1): Promise<JsonSchema> {
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
export async function convertSchema(
  schema: StandardSchemaV1,
  extra: SchemaConverters = {},
): Promise<JsonSchema> {
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
