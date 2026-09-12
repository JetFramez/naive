import type {
  UploadIssueCode,
  UploadIssueMeta,
  UploadMessage,
  UploadMessages,
} from "@notio-internal/core";

const DEFAULTS: Record<UploadIssueCode, (meta: UploadIssueMeta) => string> = {
  FILE_TOO_LARGE: (m) => `File "${m.filename}" exceeds the maximum size of ${m.limit} bytes`,
  FILE_TYPE_NOT_ALLOWED: (m) =>
    m.detected
      ? `File "${m.filename}" has type "${m.detected}" which is not allowed (expected ${(m.allowed ?? []).join(", ")})`
      : `File "${m.filename}" has an unrecognised type (expected ${(m.allowed ?? []).join(", ")})`,
  TOO_MANY_FILES: (m) =>
    `Field "${m.field}" accepts at most ${m.limit} file${m.limit === 1 ? "" : "s"}`,
  FILE_REQUIRED: (m) => `Field "${m.field}" is required`,
  UNEXPECTED_FILE: (m) => `Unexpected file field "${m.field}"`,
  TOTAL_SIZE_EXCEEDED: (m) => `Total upload size exceeds ${m.limit} bytes`,
};

/** Resolves a message: field-level, then global, then the built-in default. */
export function resolveMessage(
  meta: UploadIssueMeta,
  fieldMessages: UploadMessages | undefined,
  globalMessages: UploadMessages | undefined,
): string {
  const pick: UploadMessage | undefined = fieldMessages?.[meta.code] ?? globalMessages?.[meta.code];
  if (pick === undefined) return DEFAULTS[meta.code](meta);
  return typeof pick === "function" ? pick(meta) : pick;
}
