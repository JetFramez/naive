const UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

const PATTERN = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?\s*$/i;

/**
 * Parses a duration into milliseconds. Numbers pass through; strings accept
 * `ms`, `s`, `m`, `h`, `d`, `w` (`"5m"`, `"30d"`, `"1.5h"`). A bare number
 * string is milliseconds.
 */
export function parseDuration(value: number | string, name = "duration"): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`Invalid ${name}: ${value}`);
    }
    return value;
  }
  const match = PATTERN.exec(value);
  if (!match) throw new TypeError(`Invalid ${name}: "${value}" (expected e.g. "5m", "30d", 1500)`);
  const unit = (match[2] ?? "ms").toLowerCase();
  return Math.round(Number(match[1]) * (UNITS[unit] ?? 1));
}
