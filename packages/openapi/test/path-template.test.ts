import { describe, expect, it } from "vitest";
import { toOpenApiPath } from "../src/path-template.js";

describe("toOpenApiPath", () => {
  it("converts :name params", () => {
    expect(toOpenApiPath("/orders/:id/lines/:lineId")).toBe("/orders/{id}/lines/{lineId}");
  });

  it("converts *name wildcards", () => {
    expect(toOpenApiPath("/files/*path")).toBe("/files/{path}");
  });

  it("drops optional-group braces, keeping the parameter as always present", () => {
    expect(toOpenApiPath("/users{/:id}")).toBe("/users/{id}");
  });

  it("leaves plain paths untouched", () => {
    expect(toOpenApiPath("/orders")).toBe("/orders");
    expect(toOpenApiPath("/")).toBe("/");
  });
});
