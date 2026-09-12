import { describe, expect, it } from "vitest";
import { checkAdapter } from "../src/adapter.js";

describe("checkAdapter", () => {
  it("passes when every required method exists", () => {
    const adapter = { findUserById: async () => null, findUserByEmail: async () => null };
    expect(() =>
      checkAdapter(adapter as never, [
        { source: "strategies.session", methods: ["findUserById"] },
        { source: "auth.verifyPassword()", methods: ["findUserByEmail"] },
      ]),
    ).not.toThrow();
  });

  it("reports every missing method across every source together", () => {
    const adapter = { findUserById: async () => null };
    expect(() =>
      checkAdapter(adapter as never, [
        { source: "strategies.session", methods: ["findUserById", "createSession", "findSession"] },
        { source: "auth.verifyPassword()", methods: ["findUserByEmail"] },
      ]),
    ).toThrowError(
      /strategies\.session: missing createSession, findSession[\s\S]*auth\.verifyPassword\(\): missing findUserByEmail/,
    );
  });

  it("does not require methods no configured source asked for", () => {
    const adapter = {};
    expect(() =>
      checkAdapter(adapter as never, [{ source: "strategies.apiKey", methods: [] }]),
    ).not.toThrow();
  });
});
