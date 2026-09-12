import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import type { PasswordHasher } from "./types.js";

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLength, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export interface ScryptOptions {
  /** CPU/memory cost parameter, a power of two. Default `16384` (2^14). */
  cost?: number;
  keyLength?: number;
  saltLength?: number;
}

const DEFAULTS: Required<ScryptOptions> = { cost: 16384, keyLength: 64, saltLength: 16 };

/**
 * The default password hasher: Node's built-in `crypto.scrypt`, no native
 * dependency. Encodes as `scrypt$<cost>$<saltHex>$<hashHex>`.
 */
export function scrypt(options: ScryptOptions = {}): PasswordHasher {
  const { cost, keyLength, saltLength } = { ...DEFAULTS, ...options };
  return {
    name: "scrypt",
    async hash(password) {
      const salt = randomBytes(saltLength);
      const derived = await scryptAsync(password, salt, keyLength, { N: cost });
      return `scrypt$${cost}$${salt.toString("hex")}$${derived.toString("hex")}`;
    },
    async verify(hash, password) {
      const parts = hash.split("$");
      if (parts.length !== 4 || parts[0] !== "scrypt") return false;
      const usedCost = Number(parts[1]);
      const salt = parts[2];
      const expectedHex = parts[3];
      if (!Number.isInteger(usedCost) || !salt || !expectedHex) return false;
      try {
        const expected = Buffer.from(expectedHex, "hex");
        const derived = await scryptAsync(password, Buffer.from(salt, "hex"), expected.length, {
          N: usedCost,
        });
        return derived.length === expected.length && timingSafeEqual(derived, expected);
      } catch {
        return false;
      }
    },
  };
}
