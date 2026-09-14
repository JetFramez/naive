import type { StandardIssue, StandardResult, StandardSchemaV1 } from "@naive-internal/core";

/** A minimal Standard Schema for an unrecognised vendor, to test the fallback error and custom converters. */
export function fakeSchema(vendor: string, value: unknown = {}): StandardSchemaV1 {
  return {
    "~standard": {
      version: 1,
      vendor,
      validate: (): StandardResult<unknown> => ({ value }),
    },
  };
}

export function issue(message: string): StandardIssue {
  return { message };
}
