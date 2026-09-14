import type { RouteInfo } from "@naive-internal/core";
import { errorSchemaRef, errorStatusAndCode } from "./errors.js";
import { toOpenApiPath } from "./path-template.js";
import { convertSchema, type SchemaConverters } from "./schema/convert.js";
import { ComponentRegistry } from "./schema/hoist.js";
import type { JsonSchema } from "./schema/json-schema.js";
import { getAuthRequirement } from "./security-marker.js";
import { uploadsRequestSchema } from "./uploads-schema.js";

export interface Contact {
  readonly name?: string;
  readonly url?: string;
  readonly email?: string;
}

export interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly contact?: Contact;
}

export interface OpenApiServer {
  readonly url: string;
  readonly description?: string;
}

/** A raw OpenAPI 3.1 Security Scheme Object, keyed by the name used in `security`. */
export type SecurityScheme = Record<string, unknown>;

export interface OpenApiOptions {
  readonly info: OpenApiInfo;
  readonly servers?: readonly OpenApiServer[];
  /** Keys should match the strategy names passed to `auth.require(...)`. */
  readonly security?: Record<string, SecurityScheme>;
  /** Applied to every response schema built from `.response()`; for documenting a response envelope the framework does not know about. */
  readonly wrapResponse?: (schema: JsonSchema) => JsonSchema;
  /** Extra `~standard.vendor` → converter entries, alongside the built-in zod/valibot/arktype. */
  readonly schemaConverters?: SchemaConverters;
}

export interface OpenApiDocument {
  readonly openapi: "3.1.0";
  readonly info: OpenApiInfo;
  readonly servers?: readonly OpenApiServer[];
  readonly paths: Record<string, Record<string, unknown>>;
  readonly components: {
    readonly schemas: Record<string, JsonSchema>;
    readonly securitySchemes?: Record<string, SecurityScheme>;
  };
}

function operationId(method: string, path: string): string {
  const parts = path
    .split("/")
    .filter(Boolean)
    .map((seg) => seg.replace(/[{}*:]/g, "").replace(/^[a-z]/, (c) => c.toUpperCase()));
  return method.toLowerCase() + parts.join("");
}

function paramsFor(
  names: readonly string[],
  location: "path" | "query" | "header",
  schema: JsonSchema | undefined,
): Record<string, unknown>[] {
  if (names.length === 0) return [];
  const properties = (schema?.properties as Record<string, JsonSchema> | undefined) ?? {};
  const required = new Set(
    (schema?.required as string[] | undefined) ?? (location === "path" ? names : []),
  );
  return names.map((name) => ({
    name,
    in: location,
    required: location === "path" ? true : required.has(name),
    schema: properties[name] ?? { type: "string" },
  }));
}

function buildResponses(
  route: RouteInfo,
  registry: ComponentRegistry,
  options: OpenApiOptions,
  secured: boolean,
): Record<string, unknown> {
  const responses: Record<string, unknown> = {};

  for (const entry of route.responses) {
    const converted = registry.register(convertSchema(entry.schema, options.schemaConverters));
    const schema = options.wrapResponse ? options.wrapResponse(converted) : converted;
    responses[String(entry.status)] = {
      description: (schema.title as string | undefined) ?? "Success",
      content: { "application/json": { schema } },
    };
  }

  for (const errorClass of route.errors) {
    const { status, code } = errorStatusAndCode(errorClass);
    responses[String(status)] ??= {
      description: code,
      content: { "application/json": { schema: errorSchemaRef(registry) } },
    };
  }

  const hasInput = Boolean(
    route.schemas.params ||
      route.schemas.query ||
      route.schemas.headers ||
      route.schemas.body ||
      route.uploads,
  );
  if (hasInput) {
    responses["422"] ??= {
      description: "Validation failed",
      content: { "application/json": { schema: errorSchemaRef(registry) } },
    };
  }

  if (secured) {
    responses["401"] ??= {
      description: "Unauthorized",
      content: { "application/json": { schema: errorSchemaRef(registry) } },
    };
    responses["403"] ??= {
      description: "Forbidden",
      content: { "application/json": { schema: errorSchemaRef(registry) } },
    };
  }

  if (Object.keys(responses).length === 0) {
    responses["200"] = { description: "Success" };
  }
  return responses;
}

function buildRequestBody(
  route: RouteInfo,
  registry: ComponentRegistry,
  options: OpenApiOptions,
): unknown {
  if (route.uploads) {
    const bodySchema = route.schemas.body
      ? registry.register(convertSchema(route.schemas.body, options.schemaConverters))
      : undefined;
    const schema = uploadsRequestSchema(route.uploads, bodySchema);
    return { required: true, content: { "multipart/form-data": { schema } } };
  }
  if (route.schemas.body) {
    const schema = registry.register(convertSchema(route.schemas.body, options.schemaConverters));
    return { required: true, content: { "application/json": { schema } } };
  }
  return undefined;
}

/** Walks `routes` into an OpenAPI 3.1 document. Routes marked `.hidden()` are skipped. */
export function buildDocument(
  routes: readonly RouteInfo[],
  options: OpenApiOptions,
): OpenApiDocument {
  const registry = new ComponentRegistry();
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    if (route.hidden) continue;
    const openApiPath = toOpenApiPath(route.path);

    const paramsSchema = route.schemas.params
      ? registry.register(convertSchema(route.schemas.params, options.schemaConverters))
      : undefined;
    const querySchema = route.schemas.query
      ? registry.register(convertSchema(route.schemas.query, options.schemaConverters))
      : undefined;
    const headersSchema = route.schemas.headers
      ? registry.register(convertSchema(route.schemas.headers, options.schemaConverters))
      : undefined;

    const parameters = [
      ...paramsFor(route.params, "path", paramsSchema),
      ...paramsFor(
        querySchema ? Object.keys((querySchema.properties as object) ?? {}) : [],
        "query",
        querySchema,
      ),
      ...paramsFor(
        headersSchema ? Object.keys((headersSchema.properties as object) ?? {}) : [],
        "header",
        headersSchema,
      ),
    ];

    const requirement = route.middleware.map(getAuthRequirement).find((r) => r !== undefined);
    const secured = requirement !== undefined;
    const securityEntries = requirement
      ? requirement.strategies
          .filter((name) => options.security?.[name])
          .map((name) => ({ [name]: [] }))
      : [];

    const operation: Record<string, unknown> = {
      operationId: operationId(route.method, openApiPath),
      ...(route.summary ? { summary: route.summary } : {}),
      ...(route.tags.length > 0 ? { tags: route.tags } : {}),
      ...(route.deprecated ? { deprecated: true } : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(securityEntries.length > 0 ? { security: securityEntries } : {}),
      responses: buildResponses(route, registry, options, secured),
    };
    const requestBody = buildRequestBody(route, registry, options);
    if (requestBody) operation.requestBody = requestBody;

    paths[openApiPath] ??= {};
    paths[openApiPath][route.method.toLowerCase()] = operation;
  }

  return {
    openapi: "3.1.0",
    info: options.info,
    ...(options.servers ? { servers: options.servers } : {}),
    paths,
    components: {
      schemas: registry.schemas,
      ...(options.security ? { securitySchemes: options.security } : {}),
    },
  };
}
