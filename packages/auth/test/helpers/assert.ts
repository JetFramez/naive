/** Asserts `value` is present, for tests where the alternative is a non-null assertion. */
export function must<T>(value: T | null | undefined, message = "expected a value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}
