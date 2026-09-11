import type { Readable } from "node:stream";
import type { Simplify } from "../types.js";

export const UPLOAD_ISSUE_CODES = [
  "FILE_TOO_LARGE",
  "FILE_TYPE_NOT_ALLOWED",
  "TOO_MANY_FILES",
  "FILE_REQUIRED",
  "UNEXPECTED_FILE",
  "TOTAL_SIZE_EXCEEDED",
] as const;

export type UploadIssueCode = (typeof UPLOAD_ISSUE_CODES)[number];

export interface UploadIssueMeta {
  code: UploadIssueCode;
  field: string;
  filename?: string;
  /** The configured limit the file violated (bytes or count). */
  limit?: number;
  /** The observed value (bytes or count). */
  actual?: number;
  /** Allowed MIME types for `FILE_TYPE_NOT_ALLOWED`. */
  allowed?: readonly string[];
  /** Detected MIME type for `FILE_TYPE_NOT_ALLOWED`. */
  detected?: string;
}

export type UploadMessage = string | ((meta: UploadIssueMeta) => string);
export type UploadMessages = Partial<Record<UploadIssueCode, UploadMessage>>;

/** Per-field upload rules declared with `.uploads({ field: {...} })`. */
export interface UploadFieldSpec {
  /** Bytes or a size string such as `"5mb"`. */
  maxSize?: number | string;
  /** Exact MIME types or wildcards such as `"image/*"`. Detected by magic bytes. */
  types?: readonly string[];
  /** Declares an array field accepting up to this many files. */
  maxCount?: number;
  optional?: boolean;
  messages?: UploadMessages;
}

export type UploadFieldsSpec = Record<string, UploadFieldSpec>;

export interface UploadedFile {
  readonly field: string;
  /** Sanitised original filename. */
  readonly filename: string;
  /** Detected MIME type. */
  readonly mimeType: string;
  readonly size: number;
  /** Temp path when the file was written to disk. */
  readonly path?: string;
  /** Contents when the file stayed in memory. */
  readonly buffer?: Buffer;
  stream(): Readable;
  /** Moves the file out of the temp dir; skips cleanup. */
  move(to: string): Promise<string>;
  /** Leaves the file in the temp dir after the request; skips cleanup. */
  keep(): void;
  discard(): Promise<void>;
}

/** `ctx.uploads` for a given `.uploads()` spec. */
export type UploadsOf<U extends UploadFieldsSpec> = Simplify<{
  readonly [K in keyof U]:
    | (U[K] extends { maxCount: number } ? UploadedFile[] : UploadedFile)
    | (U[K] extends { optional: true } ? undefined : never);
}>;
