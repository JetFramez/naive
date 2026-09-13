import { x as Ctx, xt as Middleware, yt as MaybePromise } from "./index-GUzomrOd.js";
import * as jose from "jose";
//#region ../auth/dist/index.d.ts
//#region src/adapter.d.ts
/** A session or refresh-token record, keyed by the hash of the token the client holds. */
interface SessionRecord {
  readonly userId: string;
  readonly familyId: string;
  readonly expiresAt: Date;
  readonly rotatedAt: Date | null;
  /**
   * Additive beyond the brief's literal shape: when an adapter returns it,
   * `absolute` session/token lifetimes are enforced against it. Adapters that
   * do not track creation time may omit it; `absolute` then only bounds a
   * session's initial expiry, not its rolling renewal.
   */
  readonly createdAt?: Date;
}
interface CreateSessionInput {
  readonly tokenHash: string;
  readonly userId: string;
  readonly familyId: string;
  readonly expiresAt: Date;
  readonly meta?: unknown;
}
interface UpdateSessionInput {
  readonly expiresAt?: Date;
  readonly rotatedAt?: Date;
}
/**
 * Storage the auth module needs. Implement it against your database; every
 * strategy you configure only requires the subset of methods it uses, and
 * missing methods are reported together at `createAuth()`, not at first use.
 */
interface AuthAdapter<User> {
  findUserById(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<(User & {
    passwordHash: string;
  }) | null>;
  createSession(input: CreateSessionInput): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  updateSession(tokenHash: string, changes: UpdateSessionInput): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsByFamily(familyId: string): Promise<void>;
  deleteSessionsByUser(userId: string): Promise<void>;
}
type AdapterMethod = keyof AuthAdapter<unknown>;
interface AdapterRequirement {
  /** What is asking for the method: a strategy name, or a fixed capability like `"verifyPassword()"`. */
  readonly source: string;
  readonly methods: readonly AdapterMethod[];
}
/**
 * Checks that `adapter` implements every method the configured strategies
 * (and always-available capabilities) need. Throws one `Error` listing every
 * problem, so a missing adapter method fails at `createAuth()`, not at the
 * first request that needs it.
 */
export declare function checkAdapter(adapter: AuthAdapter<unknown>, requirements: readonly AdapterRequirement[]): void;
//#endregion
//#region src/csrf.d.ts
interface CsrfOptions {
  /** Cookie carrying the token. Default `"csrf"`. Readable by client script, so forms can echo it back. */
  cookie?: string;
  /** Header the token must be resubmitted in. Default `"x-csrf-token"`. */
  header?: string;
  /** Methods that do not require the header to match. Default `GET, HEAD, OPTIONS`. */
  safeMethods?: readonly string[];
}
/**
 * Double-submit-cookie CSRF protection for cookie sessions. Issues a token
 * cookie on any request that lacks one, and requires state-changing requests
 * to echo it back in a header.
 */
export declare function csrf(options?: CsrfOptions): Middleware;
//#endregion
//#region src/hash/types.d.ts
/** A password hashing scheme: `scrypt()` (default, no native dependency) or `argon2()`. */
interface PasswordHasher {
  readonly name: string;
  hash(password: string): Promise<string>;
  /** Constant-time comparison; never throws on a mismatched or malformed hash. */
  verify(hash: string, password: string): Promise<boolean>;
}
//#endregion
//#region src/strategies/types.d.ts
interface HasId {
  readonly id: string;
}
interface StrategyDeps<User> {
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
type AuthOutcome<User> = {
  readonly ok: true;
  readonly user: User;
} | {
  readonly ok: false;
  readonly presented: boolean;
};
export declare function absent<User>(): AuthOutcome<User>;
export declare function invalid<User>(): AuthOutcome<User>;
export declare function authenticated<User>(user: User): AuthOutcome<User>;
/**
 * What a strategy authenticates into `ctx.user`. A discriminant `kind`
 * (internal, not part of the public config shape) is how `createAuth` finds
 * "the session strategy" for `login`/`logout`, and "the jwt"/"opaque"
 * strategies for `issueToken`/`issueTokens`/`refresh`, whatever key name the
 * strategy was registered under.
 */
interface Strategy<User, Kind extends string = string> {
  readonly kind: Kind;
  readonly requiredAdapterMethods: readonly AdapterMethod[];
  authenticate(ctx: Ctx, deps: StrategyDeps<User>): Promise<AuthOutcome<User>>;
  login?(ctx: Ctx, user: User, deps: StrategyDeps<User>): Promise<void>;
  logout?(ctx: Ctx, deps: StrategyDeps<User>): Promise<void>;
  logoutEverywhere?(userId: string, deps: StrategyDeps<User>): Promise<void>;
}
//#endregion
//#region src/create-auth.d.ts
/** Marks a middleware produced by `auth.require()`, for tools (like the OpenAPI module) that need to see it. */
export declare const AUTH_REQUIREMENT: unique symbol;
interface AuthRequirement {
  readonly strategies: readonly string[];
}
export declare function getAuthRequirement(middleware: unknown): AuthRequirement | undefined;
interface RequireOptions {
  /**
   * For a `jwt()` strategy minted by `issueTokens()`: also confirms the
   * refresh token's family has not been revoked. Requires the adapter to
   * implement the optional `findSessionsByFamily`; without it this throws at
   * `require()` call time (a boot-time error, not a per-request one).
   */
  verifySession?: boolean;
}
interface OptionalOptions {
  /** Throw `Unauthorized` when a credential was presented but invalid, instead of leaving `ctx.user` unset. */
  rejectInvalid?: boolean;
}
interface IssueTokensResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Seconds until the access token expires. */
  readonly expiresIn: number;
}
interface CreateAuthConfig<User extends HasId> {
  adapter: AuthAdapter<User>;
  strategies: Record<string, Strategy<User>>;
  /** The strategy `require()`/`optional()` use when no strategy name is given. */
  default: string;
  /** Password hashing scheme. Defaults to `scrypt()` (no native dependency). */
  hash?: PasswordHasher;
}
interface Auth<User> {
  require(...args: Array<string | RequireOptions>): Middleware<{
    user: User;
  }>;
  optional(options?: OptionalOptions): Middleware<{
    user?: User;
  }>;
  hashPassword(password: string): Promise<string>;
  /** Constant-time; throws `Unauthorized` for an unknown email or a wrong password. */
  verifyPassword(email: string, password: string): Promise<User>;
  login(ctx: Ctx, user: User): Promise<void>;
  logout(ctx: Ctx): Promise<void>;
  logoutEverywhere(userId: string): Promise<void>;
  /** A single JWT, no refresh token, no session record. */
  issueToken(user: User, options?: {
    ttl?: number | string;
  }): Promise<string>;
  /** A JWT access token plus a rotatable opaque refresh token. */
  issueTokens(user: User): Promise<IssueTokensResult>;
  /** Rotates a refresh token; reuse of an already-rotated token revokes the whole family. */
  refresh(refreshToken: string): Promise<IssueTokensResult>;
  csrf(options?: CsrfOptions): Middleware;
}
/**
 * Builds the auth surface: strategies, sessions, JWTs, opaque tokens with
 * refresh rotation, and password hashing. Every configured strategy's
 * adapter requirements are checked here, at boot, not on first use.
 */
export declare function createAuth<User extends HasId>(config: CreateAuthConfig<User>): Auth<User>;
//#endregion
//#region src/hash/argon2.d.ts
interface Argon2Options {
  memoryCost?: number;
  timeCost?: number;
  parallelism?: number;
}
/**
 * Argon2id password hashing via the optional `@node-rs/argon2` native
 * package, imported lazily. Falls back to a clear install message when the
 * package is missing.
 */
export declare function argon2(options?: Argon2Options): PasswordHasher;
//#endregion
//#region src/hash/scrypt.d.ts
interface ScryptOptions {
  /** CPU/memory cost parameter, a power of two. Default `16384` (2^14). */
  cost?: number;
  keyLength?: number;
  saltLength?: number;
}
/**
 * The default password hasher: Node's built-in `crypto.scrypt`, no native
 * dependency. Encodes as `scrypt$<cost>$<saltHex>$<hashHex>`.
 */
export declare function scrypt(options?: ScryptOptions): PasswordHasher;
//#endregion
//#region src/principal.d.ts
/** The authenticated user for the current request, via ALS. `undefined` outside a request or if unauthenticated. */
export declare function currentUser<User = unknown>(): User | undefined;
/** Like {@link currentUser}, but throws `Unauthorized` when there is none. */
export declare function requireUser<User = unknown>(): User;
//#endregion
//#region src/strategies/api-key.d.ts
interface ApiKeyOptions<User> {
  /** Read the key from a request header. Mutually exclusive with `query`. */
  header?: string;
  /** Read the key from a query parameter. Mutually exclusive with `header`. */
  query?: string;
  /** Resolves a presented key to a user, or `null`/`undefined` when it does not check out. */
  verify: (key: string) => MaybePromise<User | null | undefined>;
}
/**
 * Auth on a caller-supplied key, verified by your own lookup (a database of
 * API keys, a third-party check, anything). notio does not store or hash
 * anything for this strategy; `verify` owns that entirely.
 */
export declare function apiKey<User extends HasId>(options: ApiKeyOptions<User>): Strategy<User, "apiKey">;
//#endregion
//#region src/strategies/custom.d.ts
interface CustomOptions<User> {
  login?: (ctx: Ctx, user: User) => MaybePromise<void>;
  logout?: (ctx: Ctx) => MaybePromise<void>;
}
/**
 * A strategy you write yourself: `resolve` inspects `ctx` and returns a user
 * (or `null`). For anything the built-in strategies don't cover — a header
 * convention, a third-party session, a proxy-injected identity.
 */
export declare function custom<User extends HasId>(resolve: (ctx: Ctx) => MaybePromise<User | null>, options?: CustomOptions<User>): Strategy<User, "custom">;
//#endregion
//#region src/strategies/jwt.d.ts
interface JwtKeyPair {
  privateKey: jose.CryptoKey | jose.KeyObject;
  publicKey: jose.CryptoKey | jose.KeyObject;
}
interface JwtOptions {
  /** Symmetric secret; signs and verifies with HMAC. Mutually exclusive with `keys`. */
  secret?: string;
  /** Asymmetric key pair, already imported (see `jose`'s `importPKCS8`/`importSPKI`). */
  keys?: JwtKeyPair;
  /** Milliseconds or a duration string. Default `"15m"`. */
  ttl?: number | string;
  issuer?: string;
  audience?: string;
  /** Default `"HS256"` for `secret`; required for `keys`. */
  algorithm?: string;
}
/** A jwt strategy, exposing what `createAuth` needs to mint tokens for `issueToken`/`issueTokens`. */
interface JwtStrategy<User> extends Strategy<User, "jwt"> {
  readonly ttlMs: number;
  sign(claims: Record<string, unknown>, ttlMs?: number): Promise<string>;
  verify(token: string): Promise<jose.JWTPayload>;
}
/**
 * Bearer auth on a signed JWT: stateless, no adapter session lookup, so it
 * cannot be revoked on its own (see `require(name, { verifySession })`).
 */
export declare function jwt<User extends HasId>(options?: JwtOptions): JwtStrategy<User>;
//#endregion
//#region src/strategies/opaque.d.ts
interface OpaqueOptions {
  /** Milliseconds or a duration string. Default `"30d"`. */
  ttl?: number | string;
  rolling?: boolean;
  absolute?: number | string;
  /** Header the bearer token arrives in. Default `"authorization"` (as `Bearer <token>`). */
  header?: string;
}
/** An opaque strategy, carrying the resolved options `createAuth` needs for `issueTokens`/`refresh`. */
interface OpaqueStrategy<User> extends Strategy<User, "opaque"> {
  readonly ttlMs: number;
  readonly rolling: boolean;
  readonly absoluteMs: number | undefined;
}
/**
 * Bearer auth on an opaque, server-stored token: the adapter holds only the
 * token's hash, so tokens can be listed and revoked. Backs `require("token")`-
 * style routes and is also what `issueTokens`/`refresh` mint as the refresh
 * token when this strategy is configured.
 */
export declare function opaque<User extends HasId>(options?: OpaqueOptions): OpaqueStrategy<User>;
//#endregion
//#region src/strategies/session.d.ts
interface CookieSessionOptions {
  /** Cookie name. Default `"sid"`. */
  cookie?: string;
  /** Milliseconds or a duration string. Default `"30d"`. */
  ttl?: number | string;
  /** Extend the session on use, throttled to one write per minute. Default `true`. */
  rolling?: boolean;
  /** A hard cap on the session lifetime, enforced from `createdAt` when the adapter reports it. */
  absolute?: number | string;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  domain?: string;
}
/**
 * Session auth backed by a signed-free, opaque cookie: the cookie holds a
 * random token, the adapter stores only its hash. `login`/`logout` on the
 * returned `auth` object operate against whichever configured strategy is a
 * `cookieSession()`.
 */
export declare function cookieSession<User extends HasId>(options?: CookieSessionOptions): Strategy<User, "session">;
//#endregion
//#region src/tokens.d.ts
/** A random, URL-safe opaque token. Never stored directly; only its hash is. */
export declare function randomToken(bytes?: number): string;
/** The form an opaque token or session cookie value takes in storage. */
export declare function hashToken(token: string): string;
/** Sessions roll forward at most this often, regardless of how many requests arrive. */
export declare const ROLL_THROTTLE_MS = 60000;
/**
 * Extends a session's expiry when it is due (rolling, throttled to one write
 * per minute), capped by `absoluteMs` from the session's `createdAt` when the
 * adapter reports one.
 */
export declare function rollSession(adapter: Pick<AuthAdapter<unknown>, "updateSession">, tokenHash: string, session: SessionRecord, ttlMs: number, absoluteMs: number | undefined): Promise<void>;
/** The initial expiry for a new session/token, bounded by `absolute` when given. */
export declare function initialExpiry(ttlMs: number, absoluteMs: number | undefined): Date;
//#endregion
export type { AdapterMethod, AdapterRequirement, ApiKeyOptions, Argon2Options, Auth, AuthAdapter, AuthOutcome, AuthRequirement, CookieSessionOptions, CreateAuthConfig, CreateSessionInput, CsrfOptions, CustomOptions, HasId, IssueTokensResult, JwtKeyPair, JwtOptions, JwtStrategy, OpaqueOptions, OpaqueStrategy, OptionalOptions, PasswordHasher, RequireOptions, ScryptOptions, SessionRecord, Strategy, StrategyDeps, UpdateSessionInput };