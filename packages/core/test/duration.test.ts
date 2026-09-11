import { describe, expect, it } from "vitest";
import { parseDuration } from "../src/index.js";

describe("parseDuration", () => {
  it("parses units and passes numbers through", () => {
    expect(parseDuration(1500)).toBe(1500);
    expect(parseDuration("1500")).toBe(1500);
    expect(parseDuration("250ms")).toBe(250);
    expect(parseDuration("5s")).toBe(5000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("1.5h")).toBe(5_400_000);
    expect(parseDuration("30d")).toBe(2_592_000_000);
    expect(parseDuration("2w")).toBe(1_209_600_000);
  });

  it("rejects garbage", () => {
    expect(() => parseDuration("soon")).toThrow(/Invalid duration/);
    expect(() => parseDuration("5y")).toThrow();
    expect(() => parseDuration(-1)).toThrow();
    expect(() => parseDuration(Number.NaN)).toThrow();
  });
});
