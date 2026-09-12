import { describe, expect, it } from "vitest";
import { argon2 } from "../src/hash/argon2.js";
import { scrypt } from "../src/hash/scrypt.js";

describe.each([
  ["scrypt", scrypt()],
  ["argon2", argon2()],
])("%s", (name, hasher) => {
  it("hashes and verifies a password", async () => {
    const hash = await hasher.hash("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
    expect(await hasher.verify(hash, "correct horse battery staple")).toBe(true);
    expect(await hasher.verify(hash, "wrong")).toBe(false);
  });

  it("produces different hashes for the same password (random salt)", async () => {
    const a = await hasher.hash("same password");
    const b = await hasher.hash("same password");
    expect(a).not.toBe(b);
  });

  it("never throws on a malformed hash", async () => {
    await expect(hasher.verify("not-a-real-hash", "x")).resolves.toBe(false);
    await expect(hasher.verify("", "x")).resolves.toBe(false);
  });

  it("reports its name", () => {
    expect(hasher.name).toBe(name);
  });
});
