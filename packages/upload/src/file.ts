import { createReadStream, type ReadStream } from "node:fs";
import { copyFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import type { UploadedFile } from "@notio-internal/core";

export interface UploadFileData {
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
export class UploadedFileImpl implements UploadedFile {
  readonly field: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  path?: string;
  readonly buffer?: Buffer;

  moved = false;
  kept = false;
  discarded = false;

  constructor(data: UploadFileData) {
    this.field = data.field;
    this.filename = data.filename;
    this.mimeType = data.mimeType;
    this.size = data.size;
    if (data.path !== undefined) this.path = data.path;
    if (data.buffer !== undefined) this.buffer = data.buffer;
  }

  stream(): Readable | ReadStream {
    if (this.discarded) throw new Error(`Upload "${this.filename}" was already discarded`);
    if (this.buffer) return Readable.from(this.buffer);
    if (this.path) return createReadStream(this.path);
    throw new Error(`Upload "${this.filename}" has no content`);
  }

  async move(to: string): Promise<string> {
    if (this.discarded) throw new Error(`Upload "${this.filename}" was already discarded`);
    await mkdir(dirname(to), { recursive: true });
    if (this.path) {
      try {
        await rename(this.path, to);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EXDEV") {
          await copyFile(this.path, to);
          await unlink(this.path);
        } else {
          throw error;
        }
      }
    } else if (this.buffer) {
      await writeFile(to, this.buffer);
    }
    this.moved = true;
    this.path = to;
    return to;
  }

  keep(): void {
    this.kept = true;
  }

  async discard(): Promise<void> {
    if (this.discarded || this.moved) return;
    if (this.path) await unlink(this.path).catch(() => {});
    this.discarded = true;
  }
}
