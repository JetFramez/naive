import { Forbidden, NotFound } from "@notio-internal/core";
import { describe, expect, it } from "vitest";
import { errorSchemaRef, errorStatusAndCode } from "../src/errors.js";
import { ComponentRegistry } from "../src/schema/hoist.js";

describe("errorStatusAndCode", () => {
  it("reads status and code off an HttpError subclass", () => {
    expect(errorStatusAndCode(NotFound)).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(errorStatusAndCode(Forbidden)).toEqual({ status: 403, code: "FORBIDDEN" });
  });
});

describe("errorSchemaRef", () => {
  it("hoists the unified error body once, as components.schemas.Error", () => {
    const registry = new ComponentRegistry();
    const first = errorSchemaRef(registry);
    const second = errorSchemaRef(registry);
    expect(first).toEqual({ $ref: "#/components/schemas/Error" });
    expect(second).toEqual(first);
    expect(registry.schemas.Error).toMatchObject({
      type: "object",
      required: ["code", "message", "requestId"],
    });
  });
});
