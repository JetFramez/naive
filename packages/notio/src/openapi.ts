// Internal packages are devDependencies here on purpose: tsdown inlines them into
// dist at build time, so they must never appear in the published dependency list.
/** `@jetframez/notio/openapi`: walks `routes()` into an OpenAPI 3.1 document, Standard Schema to JSON Schema, Scalar docs UI. */
export * from "@notio-internal/openapi";
