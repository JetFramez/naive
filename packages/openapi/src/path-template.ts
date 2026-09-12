/**
 * Express 5 path syntax to OpenAPI's `{name}` template. `:name` and `*name`
 * both become `{name}`. OpenAPI has no concept of an optional path segment,
 * so `{...}` groups are documented as always present — the braces around
 * them are simply dropped, keeping only the parameter inside.
 */
export function toOpenApiPath(path: string): string {
  return path.replace(/[{}]/g, "").replace(/[:*]([A-Za-z0-9_]+)/g, "{$1}");
}
