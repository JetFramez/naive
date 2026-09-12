export interface MultipartFieldPart {
  readonly kind: "field";
  readonly name: string;
  readonly value: string;
}

export interface MultipartFilePart {
  readonly kind: "file";
  readonly name: string;
  readonly filename: string;
  readonly content: Buffer;
  readonly contentType?: string;
}

export type MultipartPart = MultipartFieldPart | MultipartFilePart;

export function field(name: string, value: string): MultipartFieldPart {
  return { kind: "field", name, value };
}

export function file(
  name: string,
  filename: string,
  content: Buffer,
  contentType?: string,
): MultipartFilePart {
  return contentType === undefined
    ? { kind: "file", name, filename, content }
    : { kind: "file", name, filename, content, contentType };
}

/** Builds a raw `multipart/form-data` body, for tests that need to drive busboy directly. */
export function buildMultipart(parts: readonly MultipartPart[]): {
  body: Buffer;
  contentType: string;
} {
  const boundary = `notioTestBoundary${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.kind === "field") {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`));
      chunks.push(Buffer.from(part.value));
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.contentType ?? "application/octet-stream"}\r\n\r\n`,
        ),
      );
      chunks.push(part.content);
    }
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** A realistic minimal PNG: signature plus an IHDR chunk, detected by `file-type`. */
export const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000031e0f9ef",
  "hex",
);

/** A realistic minimal GIF, detected by `file-type`. */
export const GIF_BYTES = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)]);

/** Plain text content; `file-type` cannot detect a MIME type for it. */
export const TEXT_BYTES = Buffer.from("just plain text, no magic bytes here at all");
