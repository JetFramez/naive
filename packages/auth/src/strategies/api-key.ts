import type { MaybePromise } from "@naive-internal/core";
import { absent, authenticated, type HasId, invalid, type Strategy } from "./types.js";

export interface ApiKeyOptions<User> {
  /** Read the key from a request header. Mutually exclusive with `query`. */
  header?: string;
  /** Read the key from a query parameter. Mutually exclusive with `header`. */
  query?: string;
  /** Resolves a presented key to a user, or `null`/`undefined` when it does not check out. */
  verify: (key: string) => MaybePromise<User | null | undefined>;
}

/**
 * Auth on a caller-supplied key, verified by your own lookup (a database of
 * API keys, a third-party check, anything). naive does not store or hash
 * anything for this strategy; `verify` owns that entirely.
 */
export function apiKey<User extends HasId>(options: ApiKeyOptions<User>): Strategy<User, "apiKey"> {
  if (!options.header && !options.query) {
    throw new Error('apiKey(): pass "header" or "query"');
  }
  if (options.header && options.query) {
    throw new Error('apiKey(): pass "header" or "query", not both');
  }
  return {
    kind: "apiKey",
    requiredAdapterMethods: [],
    async authenticate(ctx) {
      let key: unknown;
      if (options.header) {
        key = ctx.headers.get(options.header);
      } else {
        const value = ctx.query[options.query as string];
        key = Array.isArray(value) ? value[0] : value;
      }
      if (!key || typeof key !== "string") return absent();
      const user = await options.verify(key);
      return user ? authenticated(user) : invalid();
    },
  };
}
