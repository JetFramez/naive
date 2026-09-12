import type { Ctx } from "@notio-internal/core";
import type { AdapterMethod, AuthAdapter } from "../adapter.js";
import type { PasswordHasher } from "../hash/types.js";

export interface HasId {
  readonly id: string;
}

export interface StrategyDeps<User> {
  readonly adapter: AuthAdapter<User>;
  readonly hasher: PasswordHasher;
}

/**
 * `presented: false` means the strategy found no credential at all (no
 * cookie, no header). `presented: true` with `ok: false` means a credential
 * was there but did not check out (expired, revoked, bad signature, unknown
 * user). `auth.optional()` treats these differently: absent stays silent,
 * invalid only throws when asked to (`rejectInvalid`).
 */
export type AuthOutcome<User> =
  | { readonly ok: true; readonly user: User }
  | { readonly ok: false; readonly presented: boolean };

export function absent<User>(): AuthOutcome<User> {
  return { ok: false, presented: false };
}

export function invalid<User>(): AuthOutcome<User> {
  return { ok: false, presented: true };
}

export function authenticated<User>(user: User): AuthOutcome<User> {
  return { ok: true, user };
}

/**
 * What a strategy authenticates into `ctx.user`. A discriminant `kind`
 * (internal, not part of the public config shape) is how `createAuth` finds
 * "the session strategy" for `login`/`logout`, and "the jwt"/"opaque"
 * strategies for `issueToken`/`issueTokens`/`refresh`, whatever key name the
 * strategy was registered under.
 */
export interface Strategy<User, Kind extends string = string> {
  readonly kind: Kind;
  readonly requiredAdapterMethods: readonly AdapterMethod[];
  authenticate(ctx: Ctx, deps: StrategyDeps<User>): Promise<AuthOutcome<User>>;
  login?(ctx: Ctx, user: User, deps: StrategyDeps<User>): Promise<void>;
  logout?(ctx: Ctx, deps: StrategyDeps<User>): Promise<void>;
  logoutEverywhere?(userId: string, deps: StrategyDeps<User>): Promise<void>;
}
