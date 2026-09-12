import type { HttpErrorClass } from "@notio-internal/core";
import type { ComponentRegistry } from "./schema/hoist.js";
import type { JsonSchema } from "./schema/json-schema.js";

const ERROR_SCHEMA: JsonSchema = {
  title: "Error",
  type: "object",
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    details: {},
    requestId: { type: "string" },
  },
  required: ["code", "message", "requestId"],
};

/** The unified error body, hoisted once as `components.schemas.Error`. Every error response references it. */
export function errorSchemaRef(registry: ComponentRegistry): JsonSchema {
  return registry.register(structuredClone(ERROR_SCHEMA));
}

/** Reads `status`/`code` off an `HttpError` subclass by constructing one transiently. */
export function errorStatusAndCode(errorClass: HttpErrorClass): { status: number; code: string } {
  const instance = new (errorClass as new () => Error & { status: number; code: string })();
  return { status: instance.status, code: instance.code };
}
