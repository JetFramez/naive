// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Strips directory components and unsafe characters from a client-supplied filename. */
export function sanitizeFilename(name: string): string {
  const base = name.replace(/^.*[/\\]/, "").trim();
  const cleaned = base
    .replace(CONTROL_CHARS, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : "file";
}
