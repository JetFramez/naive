import { $ as HttpErrorClass, Dn as UploadFieldsSpec, Gt as RouteInfo, dn as StandardSchemaV1 } from "./index-GUzomrOd.js";
import express, { RequestHandler } from "express";
//#region ../openapi/dist/index.d.ts
//#region src/schema/json-schema.d.ts
/** A JSON Schema fragment, as produced by the vendor converters. Loosely typed; we only ever inspect a few known keys. */
type JsonSchema = Record<string, unknown> & {
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  title?: string;
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};
//#endregion
//#region src/schema/convert.d.ts
type Converter = (schema: StandardSchemaV1) => JsonSchema;
interface SchemaConverters {
  readonly [vendor: string]: Converter;
}
/**
 * Converts a Standard Schema to JSON Schema, dispatching on `~standard.vendor`.
 * Zod, Valibot and ArkType are built in; register more via `openapi({ schemaConverters })`.
 */
export declare function convertSchema(schema: StandardSchemaV1, extra?: SchemaConverters): JsonSchema;
//#endregion
//#region src/document.d.ts
interface Contact {
  readonly name?: string;
  readonly url?: string;
  readonly email?: string;
}
interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly contact?: Contact;
}
interface OpenApiServer {
  readonly url: string;
  readonly description?: string;
}
/** A raw OpenAPI 3.1 Security Scheme Object, keyed by the name used in `security`. */
type SecurityScheme = Record<string, unknown>;
interface OpenApiOptions {
  readonly info: OpenApiInfo;
  readonly servers?: readonly OpenApiServer[];
  /** Keys should match the strategy names passed to `auth.require(...)`. */
  readonly security?: Record<string, SecurityScheme>;
  /** Applied to every response schema built from `.response()`; for documenting a response envelope the framework does not know about. */
  readonly wrapResponse?: (schema: JsonSchema) => JsonSchema;
  /** Extra `~standard.vendor` → converter entries, alongside the built-in zod/valibot/arktype. */
  readonly schemaConverters?: SchemaConverters;
}
interface OpenApiDocument {
  readonly openapi: "3.1.0";
  readonly info: OpenApiInfo;
  readonly servers?: readonly OpenApiServer[];
  readonly paths: Record<string, Record<string, unknown>>;
  readonly components: {
    readonly schemas: Record<string, JsonSchema>;
    readonly securitySchemes?: Record<string, SecurityScheme>;
  };
}
/** Walks `routes` into an OpenAPI 3.1 document. Routes marked `.hidden()` are skipped. */
export declare function buildDocument(routes: readonly RouteInfo[], options: OpenApiOptions): OpenApiDocument;
//#endregion
//#region src/docs.d.ts
/**
 * Serves the spec at `${path}/openapi.json` and a Scalar UI reading from it
 * at `path`. Mount with `app.use(spec.docs("/docs"))`.
 */
export declare function createDocsRouter(path: string, document: OpenApiDocument): express.Router;
//#endregion
//#region src/schema/hoist.d.ts
/**
 * Collects every schema that ends up under `components.schemas`. A schema is
 * hoisted when it has a `title` (Zod's `.meta({ id })`, Valibot's `v.title()`,
 * ArkType's `.configure({ title })`) or when it arrived via Zod's own
 * `$defs` (which Zod only produces for named schemas). Unnamed schemas,
 * however many times they are reused, stay inlined at each use site.
 */
export declare class ComponentRegistry {
  #private;
  readonly schemas: Record<string, JsonSchema>;
  /** Registers one converted schema, returning what to embed at its use site (a `$ref` if it was named). */
  register(raw: JsonSchema): JsonSchema;
}
//#endregion
//#region src/errors.d.ts
/** The unified error body, hoisted once as `components.schemas.Error`. Every error response references it. */
export declare function errorSchemaRef(registry: ComponentRegistry): JsonSchema;
/** Reads `status`/`code` off an `HttpError` subclass by constructing one transiently. */
export declare function errorStatusAndCode(errorClass: HttpErrorClass): {
  status: number;
  code: string;
};
//#endregion
//#region src/openapi.d.ts
/** Anything `.from()` accepts: `App` and `Router` both expose `routes()`. */
interface RouteSource {
  routes(): RouteInfo[];
}
interface OpenApiSpec {
  readonly document: OpenApiDocument;
  /** A `/${path}` UI (Scalar) reading from `${path}/openapi.json`, also served. Mount with `app.use(...)`. */
  docs(path: string): RequestHandler;
}
interface OpenApiBuilder {
  /** Walks every route across the given sources (an `App`, one or more `Router`s, or a mix) into the document. */
  from(...sources: readonly RouteSource[]): OpenApiSpec;
}
/** Builds an OpenAPI 3.1 document from notio's route metadata. No code generation. */
export declare function openapi(options: OpenApiOptions): OpenApiBuilder;
//#endregion
//#region src/path-template.d.ts
/**
 * Express 5 path syntax to OpenAPI's `{name}` template. `:name` and `*name`
 * both become `{name}`. OpenAPI has no concept of an optional path segment,
 * so `{...}` groups are documented as always present — the braces around
 * them are simply dropped, keeping only the parameter inside.
 */
export declare function toOpenApiPath(path: string): string;
//#endregion
//#region src/security-marker.d.ts
interface AuthRequirement {
  readonly strategies: readonly string[];
}
export declare function getAuthRequirement(middleware: unknown): AuthRequirement | undefined;
//#endregion
//#region src/uploads-schema.d.ts
/**
 * Builds the `multipart/form-data` request schema for a route's `.uploads()`
 * spec, merged with its `.body()` schema's properties (the multipart form's
 * text fields validate through `.body()`; see the upload module's guide).
 * File fields become `{ type: "string", format: "binary" }`, or an array of
 * those when `maxCount` is set, with constraints noted in `description`.
 */
export declare function uploadsRequestSchema(spec: UploadFieldsSpec, bodySchema: JsonSchema | undefined): JsonSchema;
//#endregion
export type { AuthRequirement, Contact, JsonSchema, OpenApiBuilder, OpenApiDocument, OpenApiInfo, OpenApiOptions, OpenApiServer, OpenApiSpec, RouteSource, SchemaConverters, SecurityScheme };