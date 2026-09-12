import type { RouteInfo } from "@notio-internal/core";
import type { RequestHandler } from "express";
import { createDocsRouter } from "./docs.js";
import { buildDocument, type OpenApiDocument, type OpenApiOptions } from "./document.js";

/** Anything `.from()` accepts: `App` and `Router` both expose `routes()`. */
export interface RouteSource {
  routes(): RouteInfo[];
}

export interface OpenApiSpec {
  readonly document: OpenApiDocument;
  /** A `/${path}` UI (Scalar) reading from `${path}/openapi.json`, also served. Mount with `app.use(...)`. */
  docs(path: string): RequestHandler;
}

export interface OpenApiBuilder {
  /**
   * Walks every route across the given sources (an `App`, one or more
   * `Router`s, or a mix) into the document. Async: schema conversion lazily
   * imports the relevant library (Zod, Valibot, ArkType).
   */
  from(...sources: readonly RouteSource[]): Promise<OpenApiSpec>;
}

/** Builds an OpenAPI 3.1 document from notio's route metadata. No code generation. */
export function openapi(options: OpenApiOptions): OpenApiBuilder {
  return {
    async from(...sources) {
      const routes = sources.flatMap((source) => source.routes());
      const document = await buildDocument(routes, options);
      return {
        document,
        docs: (path) => createDocsRouter(path, document),
      };
    },
  };
}
