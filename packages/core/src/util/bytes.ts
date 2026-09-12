const UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
};

const PATTERN = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?\s*$/i;

/**
 * Parses a byte size. Numbers pass through; strings accept `b`, `kb`, `mb`,
 * `gb`, `tb` (`"10mb"`, `"1.5gb"`). A bare number string is bytes.
 */
export function parseBytes(value: number | string, name = "size"): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`Invalid ${name}: ${value}`);
    return value;
  }
  const match = PATTERN.exec(value);
  if (!match) throw new TypeError(`Invalid ${name}: "${value}" (expected e.g. "10mb", 1024)`);
  const unit = (match[2] ?? "b").toLowerCase();
  return Math.round(Number(match[1]) * (UNITS[unit] ?? 1));
}
