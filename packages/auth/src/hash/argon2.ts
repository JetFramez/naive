import type { PasswordHasher } from "./types.js";

export interface Argon2Options {
  memoryCost?: number;
  timeCost?: number;
  parallelism?: number;
}

type Argon2Module = typeof import("@node-rs/argon2");

let mod: Argon2Module | undefined;

async function load(): Promise<Argon2Module> {
  if (mod) return mod;
  try {
    mod = await import("@node-rs/argon2");
  } catch {
    throw new Error(
      'Argon2 password hashing requires the optional package "@node-rs/argon2": pnpm add @node-rs/argon2',
    );
  }
  return mod;
}

/**
 * Argon2id password hashing via the optional `@node-rs/argon2` native
 * package, imported lazily. Falls back to a clear install message when the
 * package is missing.
 */
export function argon2(options: Argon2Options = {}): PasswordHasher {
  return {
    name: "argon2",
    async hash(password) {
      const { hash } = await load();
      return hash(password, options);
    },
    async verify(hashed, password) {
      const { verify } = await load();
      try {
        return await verify(hashed, password);
      } catch {
        return false;
      }
    },
  };
}
