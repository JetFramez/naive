import { describe, expect, it } from "vitest";
import { getAuthRequirement } from "../src/security-marker.js";

const AUTH_REQUIREMENT: unique symbol = Symbol.for("naive.auth.requirement");

function markedMiddleware(strategies: string[]) {
  const mw = async () => {};
  Object.defineProperty(mw, AUTH_REQUIREMENT, { value: { strategies }, enumerable: false });
  return mw;
}

describe("getAuthRequirement", () => {
  it("reads the marker set via the shared global symbol, with no import from the auth package", () => {
    const mw = markedMiddleware(["session", "bearer"]);
    expect(getAuthRequirement(mw)).toEqual({ strategies: ["session", "bearer"] });
  });

  it("is undefined for plain middleware", () => {
    expect(getAuthRequirement(async () => {})).toBeUndefined();
  });

  it("is undefined for non-functions and malformed markers", () => {
    expect(getAuthRequirement({})).toBeUndefined();
    expect(getAuthRequirement(undefined)).toBeUndefined();
    const bad = async () => {};
    Object.defineProperty(bad, AUTH_REQUIREMENT, { value: { strategies: "not-an-array" } });
    expect(getAuthRequirement(bad)).toBeUndefined();
  });
});
