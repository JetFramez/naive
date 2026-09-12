import type { Ctx, MaybePromise } from "@notio-internal/core";
import { absent, authenticated, type HasId, type Strategy } from "./types.js";

export interface CustomOptions<User> {
  login?: (ctx: Ctx, user: User) => MaybePromise<void>;
  logout?: (ctx: Ctx) => MaybePromise<void>;
}

/**
 * A strategy you write yourself: `resolve` inspects `ctx` and returns a user
 * (or `null`). For anything the built-in strategies don't cover — a header
 * convention, a third-party session, a proxy-injected identity.
 */
export function custom<User extends HasId>(
  resolve: (ctx: Ctx) => MaybePromise<User | null>,
  options: CustomOptions<User> = {},
): Strategy<User, "custom"> {
  const strategy: Strategy<User, "custom"> = {
    kind: "custom",
    requiredAdapterMethods: [],
    async authenticate(ctx) {
      const user = await resolve(ctx);
      // `resolve` collapses "no credential" and "invalid credential" into one
      // `null`; without a way to tell them apart we treat it as absent, so
      // `auth.optional()` never rejects a custom strategy's null.
      return user ? authenticated(user) : absent();
    },
  };
  if (options.login) {
    const login = options.login;
    (strategy as Strategy<User, "custom">).login = async (ctx, user) => {
      await login(ctx, user);
    };
  }
  if (options.logout) {
    const logout = options.logout;
    (strategy as Strategy<User, "custom">).logout = async (ctx) => {
      await logout(ctx);
    };
  }
  return strategy;
}
