import { apiReference } from "@scalar/express-api-reference";
import express from "express";
import type { OpenApiDocument } from "./document.js";

/**
 * Serves the spec at `${path}/openapi.json` and a Scalar UI reading from it
 * at `path`. Mount with `app.use(spec.docs("/docs"))`.
 */
export function createDocsRouter(path: string, document: OpenApiDocument): express.Router {
  const router = express.Router();
  const jsonPath = `${path}/openapi.json`;
  // Registered before the UI: express.Router#use matches by prefix, so the
  // UI handler below would otherwise also catch requests for the JSON file.
  router.get(jsonPath, (_req, res) => {
    res.json(document);
  });
  router.use(path, apiReference({ url: jsonPath }));
  return router;
}
