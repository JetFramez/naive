import type { UploadFieldsSpec } from "@naive-internal/core";
import type { JsonSchema } from "./schema/json-schema.js";

/**
 * Builds the `multipart/form-data` request schema for a route's `.uploads()`
 * spec, merged with its `.body()` schema's properties (the multipart form's
 * text fields validate through `.body()`; see the upload module's guide).
 * File fields become `{ type: "string", format: "binary" }`, or an array of
 * those when `maxCount` is set, with constraints noted in `description`.
 */
export function uploadsRequestSchema(
  spec: UploadFieldsSpec,
  bodySchema: JsonSchema | undefined,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {
    ...(bodySchema?.properties as Record<string, JsonSchema> | undefined),
  };
  const required = new Set<string>((bodySchema?.required as string[] | undefined) ?? []);

  for (const [name, field] of Object.entries(spec)) {
    const constraints: string[] = [];
    if (field.maxSize !== undefined) constraints.push(`Max size: ${field.maxSize}.`);
    if (field.types?.length) constraints.push(`Allowed types: ${field.types.join(", ")}.`);
    if (field.maxCount !== undefined) constraints.push(`Up to ${field.maxCount} file(s).`);
    const description = constraints.length > 0 ? constraints.join(" ") : undefined;

    const file: JsonSchema = { type: "string", format: "binary" };
    if (description) file.description = description;
    properties[name] = field.maxCount !== undefined ? { type: "array", items: file } : file;
    if (!field.optional) required.add(name);
  }

  const schema: JsonSchema = { type: "object", properties };
  if (required.size > 0) schema.required = [...required];
  return schema;
}
