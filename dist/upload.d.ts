import { An as UploadMessage, Dn as UploadFieldsSpec, Dt as ParsedUploads, En as UploadFieldSpec, Lt as RequestContext, Mn as UploadedFile, Nn as UploadsOf, On as UploadIssueCode, P as EnvSchema, ht as Logger, jn as UploadMessages, kn as UploadIssueMeta, nt as InferConfigInput, xn as UPLOAD_ISSUE_CODES } from "./index-GUzomrOd.js";
import { RequestHandler } from "express";
import { Readable } from "node:stream";
import { ReadStream } from "node:fs";
//#region ../upload/dist/index.d.ts
//#region src/file.d.ts
interface UploadFileData {
  field: string;
  filename: string;
  mimeType: string;
  size: number;
  path?: string;
  buffer?: Buffer;
}
/**
 * Runtime `UploadedFile`. Backed by a temp-dir path or an in-memory buffer.
 * Tracks `moved`/`kept`/`discarded` so request cleanup knows what to leave alone.
 */
export declare class UploadedFileImpl implements UploadedFile {
  readonly field: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  path?: string;
  readonly buffer?: Buffer;
  moved: boolean;
  kept: boolean;
  discarded: boolean;
  constructor(data: UploadFileData);
  stream(): Readable | ReadStream;
  move(to: string): Promise<string>;
  keep(): void;
  discard(): Promise<void>;
}
//#endregion
//#region src/messages.d.ts
/** Resolves a message: field-level, then global, then the built-in default. */
export declare function resolveMessage(meta: UploadIssueMeta, fieldMessages: UploadMessages | undefined, globalMessages: UploadMessages | undefined): string;
//#endregion
//#region src/parse.d.ts
interface ResolvedUploadOptions {
  readonly tempDir: string;
  readonly maxFileSize: number;
  readonly maxTotalSize: number;
  readonly memoryThreshold: number;
  readonly types: readonly string[] | undefined;
  readonly messages: UploadMessages | undefined;
}
/** Builds an `UploadsParser` from resolved global options; registered with core via `setUploadsParser`. */
export declare function createParser(options: ResolvedUploadOptions): (ctx: RequestContext, spec: UploadFieldsSpec) => Promise<ParsedUploads>;
//#endregion
//#region src/sanitize.d.ts
/** Strips directory components and unsafe characters from a client-supplied filename. */
export declare function sanitizeFilename(name: string): string;
//#endregion
//#region src/sniff.d.ts
/** Bytes needed for reliable magic-byte detection; smaller samples still detect many formats. */
export declare const SNIFF_SAMPLE_SIZE = 4100;
/** Detects a MIME type from content, never from the client-supplied header. */
export declare function detectType(sample: Buffer): Promise<string | undefined>;
/** `types` may list exact MIME types or wildcards such as `"image/*"`. */
export declare function matchesTypes(mime: string | undefined, types: readonly string[] | undefined): boolean;
//#endregion
//#region src/sweep.d.ts
/** Removes subdirectories of `tempDir` whose modification time is older than `maxAgeMs`. Best-effort. */
export declare function sweepTempDir(tempDir: string, maxAgeMs: number, logger: Logger): Promise<void>;
//#endregion
//#region src/uploads.d.ts
/** Config fragment for the primitive (env-representable) global options. */
export declare const uploadConfig: {
  tempDir: EnvSchema<string, string>;
  maxFileSize: EnvSchema<string | number, number>;
  maxTotalSize: EnvSchema<string | number, number>;
  memoryThreshold: EnvSchema<string | number, number>;
  sweepAfter: EnvSchema<string | number, number>;
};
interface UploadsOptions extends InferConfigInput<typeof uploadConfig> {
  /** Default allowed MIME types (exact or `"image/*"`) for fields that do not declare their own. */
  types?: readonly string[] | undefined;
  /** Default messages for fields that do not declare their own. */
  messages?: UploadMessages | undefined;
}
/**
 * Installs the upload module: resolves global options, sweeps stale temp
 * directories from a previous run, and registers the parser that
 * `.uploads()` routes need. Returns an inert Express handler for `app.use()`;
 * registration happens as soon as this function runs.
 */
export declare function uploads(options?: UploadsOptions): RequestHandler;
//#endregion
export { type ResolvedUploadOptions, UPLOAD_ISSUE_CODES, type UploadFieldSpec, type UploadFieldsSpec, type UploadIssueCode, type UploadIssueMeta, type UploadMessage, type UploadMessages, type UploadedFile, type UploadsOf, type UploadsOptions };