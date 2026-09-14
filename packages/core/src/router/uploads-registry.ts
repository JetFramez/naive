import type { RequestContext } from "../ctx/create.js";
import type { UploadFieldsSpec } from "./uploads.js";

export interface ParsedUploads {
  /** `ctx.uploads` for the route: one `UploadedFile` or `UploadedFile[]` per declared field. */
  readonly uploads: Record<string, unknown>;
  /** Text fields collected from the multipart form, for `.body()` to validate. */
  readonly body: unknown;
}

/**
 * Parses a multipart request against a route's `.uploads()` spec. Registered
 * by the upload module; core has no dependency on busboy or file-type.
 */
export type UploadsParser = (ctx: RequestContext, spec: UploadFieldsSpec) => Promise<ParsedUploads>;

let parser: UploadsParser | undefined;

/** @internal Called by the upload module's middleware. */
export function setUploadsParser(fn: UploadsParser): void {
  parser = fn;
}

/** @internal Test-only reset. */
export function clearUploadsParser(): void {
  parser = undefined;
}

export function getUploadsParser(): UploadsParser | undefined {
  return parser;
}

export const UPLOAD_MODULE_INSTALL_MESSAGE =
  "declares .uploads() but the upload module is not installed. Install it and register it: " +
  'import { uploads } from "@jetframez/notio/upload"; app.use(uploads());';
