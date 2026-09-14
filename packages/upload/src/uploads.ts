import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  env,
  getRootLogger,
  type InferConfigInput,
  resolveConfig,
  setUploadsParser,
  type UploadMessages,
} from "@naive-internal/core";
import type { RequestHandler } from "express";
import { createParser } from "./parse.js";
import { sweepTempDir } from "./sweep.js";

/** Config fragment for the primitive (env-representable) global options. */
export const uploadConfig = {
  tempDir: env.string({ default: join(tmpdir(), "naive-uploads") }),
  maxFileSize: env.bytes({ default: "10mb" }),
  maxTotalSize: env.bytes({ default: "50mb" }),
  memoryThreshold: env.bytes({ default: "0" }),
  sweepAfter: env.duration({ default: "1h" }),
};

export interface UploadsOptions extends InferConfigInput<typeof uploadConfig> {
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
export function uploads(options: UploadsOptions = {}): RequestHandler {
  const { types, messages, ...primitives } = options;
  const resolved = resolveConfig(uploadConfig, primitives, "uploads()");

  setUploadsParser(
    createParser({
      tempDir: resolved.tempDir,
      maxFileSize: resolved.maxFileSize,
      maxTotalSize: resolved.maxTotalSize,
      memoryThreshold: resolved.memoryThreshold,
      types,
      messages,
    }),
  );

  void sweepTempDir(resolved.tempDir, resolved.sweepAfter, getRootLogger());

  return (_req, _res, next) => next();
}
