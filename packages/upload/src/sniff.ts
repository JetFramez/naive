import { fileTypeFromBuffer } from "file-type";

/** Bytes needed for reliable magic-byte detection; smaller samples still detect many formats. */
export const SNIFF_SAMPLE_SIZE = 4100;

/** Detects a MIME type from content, never from the client-supplied header. */
export async function detectType(sample: Buffer): Promise<string | undefined> {
  const result = await fileTypeFromBuffer(sample);
  return result?.mime;
}

/** `types` may list exact MIME types or wildcards such as `"image/*"`. */
export function matchesTypes(
  mime: string | undefined,
  types: readonly string[] | undefined,
): boolean {
  if (!types || types.length === 0) return true;
  if (mime === undefined) return false;
  return types.some((t) => (t.endsWith("/*") ? mime.startsWith(t.slice(0, -1)) : mime === t));
}
