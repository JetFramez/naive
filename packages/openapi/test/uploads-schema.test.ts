import { describe, expect, it } from "vitest";
import { uploadsRequestSchema } from "../src/uploads-schema.js";

describe("uploadsRequestSchema", () => {
  it("builds a single binary field, required by default", () => {
    const schema = uploadsRequestSchema({ avatar: {} }, undefined);
    expect(schema).toEqual({
      type: "object",
      properties: { avatar: { type: "string", format: "binary" } },
      required: ["avatar"],
    });
  });

  it("builds an array field when maxCount is set, and omits required when optional", () => {
    const schema = uploadsRequestSchema(
      { gallery: { maxCount: 6, optional: true, types: ["image/*"], maxSize: "5mb" } },
      undefined,
    );
    expect(schema.properties?.gallery).toEqual({
      type: "array",
      items: {
        type: "string",
        format: "binary",
        description: "Max size: 5mb. Allowed types: image/*. Up to 6 file(s).",
      },
    });
    expect(schema.required).toBeUndefined();
  });

  it("merges the body schema's text-field properties alongside the file fields", () => {
    const bodySchema = {
      type: "object" as const,
      properties: { title: { type: "string" } },
      required: ["title"],
    };
    const schema = uploadsRequestSchema({ avatar: {} }, bodySchema);
    expect(schema.properties).toEqual({
      title: { type: "string" },
      avatar: { type: "string", format: "binary" },
    });
    expect(schema.required).toEqual(["title", "avatar"]);
  });
});
