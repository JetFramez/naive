/** A JSON Schema fragment, as produced by the vendor converters. Loosely typed; we only ever inspect a few known keys. */
export type JsonSchema = Record<string, unknown> & {
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  title?: string;
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};
