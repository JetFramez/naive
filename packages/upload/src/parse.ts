import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  BadRequest,
  type ParsedUploads,
  parseBytes,
  type RequestContext,
  type UploadFieldsSpec,
  type UploadIssueCode,
  type UploadIssueMeta,
  type UploadMessages,
  type ValidationIssue,
  validationError,
} from "@naive-internal/core";
import busboy from "busboy";
import { UploadedFileImpl } from "./file.js";
import { resolveMessage } from "./messages.js";
import { sanitizeFilename } from "./sanitize.js";
import { detectType, matchesTypes, SNIFF_SAMPLE_SIZE } from "./sniff.js";

export interface ResolvedUploadOptions {
  readonly tempDir: string;
  readonly maxFileSize: number;
  readonly maxTotalSize: number;
  readonly memoryThreshold: number;
  readonly types: readonly string[] | undefined;
  readonly messages: UploadMessages | undefined;
}

interface FileOutcome {
  readonly field: string;
  readonly file?: UploadedFileImpl;
  readonly issue?: { code: UploadIssueCode; filename: string; extra?: Record<string, unknown> };
}

function issueMeta(
  code: UploadIssueCode,
  field: string,
  filename: string,
  extra?: Record<string, unknown>,
): UploadIssueMeta {
  return { code, field, filename, ...extra } as UploadIssueMeta;
}

function toIssue(
  meta: UploadIssueMeta,
  fieldMessages: UploadMessages | undefined,
  globalMessages: UploadMessages | undefined,
): ValidationIssue {
  return {
    path: meta.field,
    code: meta.code,
    message: resolveMessage(meta, fieldMessages, globalMessages),
    meta,
  };
}

/**
 * Reads one file part to completion: accumulates in memory up to
 * `memoryThreshold`, then spills to `dir`; cuts the stream mid-write when it
 * exceeds the field's size limit, and sniffs the type from the leading bytes.
 */
function consumeFile(
  stream: NodeJS.ReadableStream,
  dir: string,
  maxSize: number,
  memoryThreshold: number,
  types: readonly string[] | undefined,
  onBytes: (n: number) => boolean,
): Promise<{
  size: number;
  path?: string;
  buffer?: Buffer;
  mimeType?: string;
  rejected?: { code: UploadIssueCode; extra?: Record<string, unknown> };
}> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let sample = Buffer.alloc(0);
    let buffer: Buffer | null = Buffer.alloc(0);
    let writeStream: ReturnType<typeof createWriteStream> | undefined;
    let diskPath: string | undefined;
    let rejected: { code: UploadIssueCode; extra?: Record<string, unknown> } | undefined;

    const spill = () => {
      diskPath = join(dir, randomUUID());
      writeStream = createWriteStream(diskPath);
      if (buffer && buffer.length > 0) writeStream.write(buffer);
      buffer = null;
    };

    stream.on("data", (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (sample.length < SNIFF_SAMPLE_SIZE)
        sample = Buffer.concat([sample, chunk]).subarray(0, SNIFF_SAMPLE_SIZE);

      if (size > maxSize) {
        rejected = { code: "FILE_TOO_LARGE", extra: { limit: maxSize, actual: size } };
        writeStream?.destroy();
        return;
      }
      if (!onBytes(chunk.length)) {
        rejected = { code: "TOTAL_SIZE_EXCEEDED" };
        writeStream?.destroy();
        return;
      }

      if (buffer !== null) {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > memoryThreshold) spill();
      } else {
        writeStream?.write(chunk);
      }
    });

    stream.on("error", reject);

    stream.on("end", async () => {
      if (writeStream) await new Promise<void>((res) => writeStream?.end(res));
      if (rejected) {
        if (diskPath) await unlink(diskPath).catch(() => {});
        resolve({ size, rejected });
        return;
      }
      const mimeType = await detectType(sample);
      if (!matchesTypes(mimeType, types)) {
        if (diskPath) await unlink(diskPath).catch(() => {});
        resolve({
          size,
          rejected: {
            code: "FILE_TYPE_NOT_ALLOWED",
            extra: { detected: mimeType, allowed: types },
          },
        });
        return;
      }
      resolve({
        size,
        ...(diskPath === undefined ? {} : { path: diskPath }),
        ...(buffer === null ? {} : { buffer }),
        ...(mimeType === undefined ? {} : { mimeType }),
      });
    });
  });
}

/** Builds an `UploadsParser` from resolved global options; registered with core via `setUploadsParser`. */
export function createParser(options: ResolvedUploadOptions) {
  return async (ctx: RequestContext, spec: UploadFieldsSpec): Promise<ParsedUploads> => {
    const contentType = ctx.req.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new BadRequest("Expected multipart/form-data for a route that declares .uploads()");
    }

    const dir = join(options.tempDir, ctx.requestId);
    await mkdir(dir, { recursive: true });

    const bb = busboy({ headers: ctx.req.headers as Record<string, string> });
    const body: Record<string, unknown> = {};
    const counts: Record<string, number> = {};
    const outcomes: Promise<FileOutcome>[] = [];
    const created: UploadedFileImpl[] = [];

    let totalBytes = 0;
    let totalExceeded = false;
    const trackTotal = (n: number): boolean => {
      totalBytes += n;
      if (totalBytes > options.maxTotalSize) totalExceeded = true;
      return !totalExceeded;
    };

    bb.on("field", (name, value) => {
      body[name] = value;
    });

    bb.on("file", (name, stream, info) => {
      const filename = sanitizeFilename(info.filename);
      const fieldSpec = spec[name];

      if (!fieldSpec) {
        stream.resume();
        outcomes.push(
          Promise.resolve({ field: name, issue: { code: "UNEXPECTED_FILE", filename } }),
        );
        return;
      }

      const maxCount = fieldSpec.maxCount ?? 1;
      counts[name] = (counts[name] ?? 0) + 1;
      if (counts[name] > maxCount) {
        stream.resume();
        outcomes.push(
          Promise.resolve({
            field: name,
            issue: { code: "TOO_MANY_FILES", filename, extra: { limit: maxCount } },
          }),
        );
        return;
      }

      const maxSize =
        fieldSpec.maxSize === undefined ? options.maxFileSize : parseBytes(fieldSpec.maxSize);
      const types = fieldSpec.types ?? options.types;

      outcomes.push(
        consumeFile(stream, dir, maxSize, options.memoryThreshold, types, trackTotal).then(
          (result) => {
            if (result.rejected) return { field: name, issue: { ...result.rejected, filename } };
            const file = new UploadedFileImpl({
              field: name,
              filename,
              mimeType: result.mimeType ?? "application/octet-stream",
              size: result.size,
              ...(result.path === undefined ? {} : { path: result.path }),
              ...(result.buffer === undefined ? {} : { buffer: result.buffer }),
            });
            created.push(file);
            return { field: name, file };
          },
        ),
      );
    });

    const finished = new Promise<void>((resolve, reject) => {
      bb.on("error", (err) => reject(err instanceof Error ? err : new Error(String(err))));
      bb.on("close", resolve);
    });

    ctx.req.pipe(bb);
    try {
      await finished;
    } catch (error) {
      throw new BadRequest(`Malformed multipart request: ${(error as Error).message}`);
    }
    const settled = await Promise.all(outcomes);

    // Cleanup runs once the response is done, whatever the outcome, and leaves
    // moved/kept files alone.
    const cleanup = async () => {
      for (const file of created) {
        if (!file.moved && !file.kept) await file.discard();
      }
      await rmdir(dir).catch(() => {});
    };
    ctx.res.once("finish", () => void cleanup());
    ctx.res.once("close", () => void cleanup());

    if (totalExceeded) {
      const meta = issueMeta("TOTAL_SIZE_EXCEEDED", "", "", {
        limit: options.maxTotalSize,
        actual: totalBytes,
      });
      throw validationError("uploads", [toIssue(meta, undefined, options.messages)]);
    }

    const issues: ValidationIssue[] = [];
    const uploads: Record<string, unknown> = {};
    for (const outcome of settled) {
      const fieldSpec = spec[outcome.field];
      if (outcome.issue) {
        const meta = issueMeta(
          outcome.issue.code,
          outcome.field,
          outcome.issue.filename,
          outcome.issue.extra,
        );
        issues.push(toIssue(meta, fieldSpec?.messages, options.messages));
        continue;
      }
      if (!outcome.file) continue;
      if (fieldSpec?.maxCount !== undefined) {
        const list = (uploads[outcome.field] as UploadedFileImpl[] | undefined) ?? [];
        list.push(outcome.file);
        uploads[outcome.field] = list;
      } else {
        uploads[outcome.field] = outcome.file;
      }
    }

    for (const [name, fieldSpec] of Object.entries(spec)) {
      // Skip fields that had at least one file part, even if it was rejected:
      // FILE_REQUIRED means "no attempt was made", not "the attempt failed".
      if (uploads[name] !== undefined || (counts[name] ?? 0) > 0) continue;
      if (fieldSpec.optional) continue;
      const meta = issueMeta("FILE_REQUIRED", name, "");
      issues.push(toIssue(meta, fieldSpec.messages, options.messages));
    }

    if (issues.length > 0) throw validationError("uploads", issues);
    return { uploads, body };
  };
}
