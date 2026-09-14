import {
  type Ctx,
  Internal,
  type Middleware,
  parseDuration,
  Unauthorized,
} from "@naive-internal/core";
import type { AuthAdapter, SessionRecord } from "./adapter.js";
import { type AdapterRequirement, checkAdapter } from "./adapter.js";
import { type CsrfOptions, csrf } from "./csrf.js";
import { scrypt } from "./hash/scrypt.js";
import type { PasswordHasher } from "./hash/types.js";
import type { JwtStrategy } from "./strategies/jwt.js";
import type { OpaqueStrategy } from "./strategies/opaque.js";
import type { HasId, Strategy } from "./strategies/types.js";
import { hashToken, initialExpiry, randomToken } from "./tokens.js";

/** Marks a middleware produced by `auth.require()`, for tools (like the OpenAPI module) that need to see it. */
export const AUTH_REQUIREMENT: unique symbol = Symbol.for("naive.auth.requirement");

export interface AuthRequirement {
  readonly strategies: readonly string[];
}

export function getAuthRequirement(middleware: unknown): AuthRequirement | undefined {
  if (typeof middleware !== "function") return undefined;
  return (middleware as { [AUTH_REQUIREMENT]?: AuthRequirement })[AUTH_REQUIREMENT];
}

export interface RequireOptions {
  /**
   * For a `jwt()` strategy minted by `issueTokens()`: also confirms the
   * refresh token's family has not been revoked. Requires the adapter to
   * implement the optional `findSessionsByFamily`; without it this throws at
   * `require()` call time (a boot-time error, not a per-request one).
   */
  verifySession?: boolean;
}

export interface OptionalOptions {
  /** Throw `Unauthorized` when a credential was presented but invalid, instead of leaving `ctx.user` unset. */
  rejectInvalid?: boolean;
}

export interface IssueTokensResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Seconds until the access token expires. */
  readonly expiresIn: number;
}

export interface CreateAuthConfig<User extends HasId> {
  adapter: AuthAdapter<User>;
  strategies: Record<string, Strategy<User>>;
  /** The strategy `require()`/`optional()` use when no strategy name is given. */
  default: string;
  /** Password hashing scheme. Defaults to `scrypt()` (no native dependency). */
  hash?: PasswordHasher;
}

export interface Auth<User> {
  require(...args: Array<string | RequireOptions>): Middleware<{ user: User }>;
  optional(options?: OptionalOptions): Middleware<{ user?: User }>;
  hashPassword(password: string): Promise<string>;
  /** Constant-time; throws `Unauthorized` for an unknown email or a wrong password. */
  verifyPassword(email: string, password: string): Promise<User>;
  login(ctx: Ctx, user: User): Promise<void>;
  logout(ctx: Ctx): Promise<void>;
  logoutEverywhere(userId: string): Promise<void>;
  /** A single JWT, no refresh token, no session record. */
  issueToken(user: User, options?: { ttl?: number | string }): Promise<string>;
  /** A JWT access token plus a rotatable opaque refresh token. */
  issueTokens(user: User): Promise<IssueTokensResult>;
  /** Rotates a refresh token; reuse of an already-rotated token revokes the whole family. */
  refresh(refreshToken: string): Promise<IssueTokensResult>;
  csrf(options?: CsrfOptions): Middleware;
}

function findByKind<Kind extends string, S extends Strategy<unknown, Kind>>(
  strategies: Record<string, Strategy<unknown>>,
  kind: Kind,
): S | undefined {
  return Object.values(strategies).find((s): s is S => s.kind === kind);
}

function findLoginStrategy<User>(
  strategies: Record<string, Strategy<User>>,
): Strategy<User> | undefined {
  return Object.values(strategies).find((s) => typeof s.login === "function");
}

function findLogoutStrategy<User>(
  strategies: Record<string, Strategy<User>>,
): Strategy<User> | undefined {
  return Object.values(strategies).find((s) => typeof s.logout === "function");
}

/**
 * Builds the auth surface: strategies, sessions, JWTs, opaque tokens with
 * refresh rotation, and password hashing. Every configured strategy's
 * adapter requirements are checked here, at boot, not on first use.
 */
export function createAuth<User extends HasId>(config: CreateAuthConfig<User>): Auth<User> {
  const { adapter, strategies } = config;
  const hasher = config.hash ?? scrypt();

  if (!strategies[config.default]) {
    throw new Error(`createAuth(): default strategy "${config.default}" is not in "strategies"`);
  }

  const requirements: AdapterRequirement[] = [
    { source: "auth.verifyPassword()", methods: ["findUserByEmail"] },
    ...Object.entries(strategies).map(([name, strategy]) => ({
      source: `strategies.${name}`,
      methods: strategy.requiredAdapterMethods,
    })),
  ];
  checkAdapter(adapter as AuthAdapter<unknown>, requirements);

  const deps = { adapter, hasher };
  const jwtStrategy = findByKind<"jwt", JwtStrategy<User>>(strategies, "jwt");
  const opaqueStrategy = findByKind<"opaque", OpaqueStrategy<User>>(strategies, "opaque");

  const extendedAdapter = adapter as AuthAdapter<User> & {
    findSessionsByFamily?(familyId: string): Promise<readonly SessionRecord[]>;
  };

  async function verifySessionFamily(payload: { fid?: unknown }): Promise<boolean> {
    if (!extendedAdapter.findSessionsByFamily) {
      throw new Internal(
        'auth.require(..., { verifySession: true }) needs the adapter to implement "findSessionsByFamily(familyId)"',
      );
    }
    if (typeof payload.fid !== "string") return false;
    const sessions = await extendedAdapter.findSessionsByFamily(payload.fid);
    return sessions.some((s) => s.expiresAt.getTime() > Date.now());
  }

  function require(...args: Array<string | RequireOptions>): Middleware<{ user: User }> {
    const trailing =
      args.length > 0 && typeof args[args.length - 1] === "object"
        ? (args.pop() as RequireOptions)
        : undefined;
    const names = (args as string[]).length > 0 ? (args as string[]) : [config.default];
    for (const name of names) {
      if (!strategies[name]) throw new Error(`auth.require(): unknown strategy "${name}"`);
    }
    if (trailing?.verifySession) {
      for (const name of names) {
        if (strategies[name]?.kind !== "jwt") {
          throw new Error(
            `auth.require(): { verifySession: true } only applies to a "jwt" strategy (got "${name}")`,
          );
        }
      }
    }

    const middleware: Middleware<{ user: User }> = async (ctx, next) => {
      for (const name of names) {
        const strategy = strategies[name] as Strategy<User>;
        const outcome = await strategy.authenticate(ctx, deps);
        if (!outcome.ok) continue;
        if (trailing?.verifySession) {
          const raw = ctx.bearer();
          // Re-verify: the token was already checked inside authenticate() moments ago (same
          // string), so this is not trusting anything new, just recovering the claims.
          const payload = raw
            ? await (strategy as JwtStrategy<User>).verify(raw).catch(() => ({}))
            : {};
          if (!(await verifySessionFamily(payload))) continue;
        }
        ctx.user = outcome.user;
        await next();
        return;
      }
      throw new Unauthorized();
    };
    Object.defineProperty(middleware, AUTH_REQUIREMENT, {
      value: { strategies: names } satisfies AuthRequirement,
      enumerable: false,
    });
    return middleware;
  }

  function optional(options: OptionalOptions = {}): Middleware<{ user?: User }> {
    return async (ctx, next) => {
      const strategy = strategies[config.default] as Strategy<User>;
      const outcome = await strategy.authenticate(ctx, deps);
      if (outcome.ok) {
        ctx.user = outcome.user;
      } else if (outcome.presented && options.rejectInvalid) {
        throw new Unauthorized();
      }
      await next();
    };
  }

  async function verifyPassword(email: string, password: string): Promise<User> {
    const record = await adapter.findUserByEmail(email);
    // Hash a dummy password even on a miss, so the response time does not reveal whether the email exists.
    const ok = await hasher.verify(record?.passwordHash ?? (await hasher.hash("")), password);
    if (!record || !ok) throw new Unauthorized("Invalid email or password");
    // Strip passwordHash: the adapter's record carries it, but the declared
    // return type is User, and a naive `res.json(user)` would otherwise leak
    // the hash to the client despite the type system saying it's not there.
    const { passwordHash: _passwordHash, ...user } = record;
    return user as unknown as User;
  }

  async function login(ctx: Ctx, user: User): Promise<void> {
    const strategy = findLoginStrategy(strategies);
    if (!strategy?.login) {
      throw new Error(
        "auth.login(): no configured strategy implements login() (cookieSession(), or custom() with a login hook)",
      );
    }
    await strategy.login(ctx, user, deps);
  }

  async function logout(ctx: Ctx): Promise<void> {
    const strategy = findLogoutStrategy(strategies);
    if (!strategy?.logout) {
      throw new Error(
        "auth.logout(): no configured strategy implements logout() (cookieSession(), or custom() with a logout hook)",
      );
    }
    await strategy.logout(ctx, deps);
  }

  async function logoutEverywhere(userId: string): Promise<void> {
    await adapter.deleteSessionsByUser(userId);
  }

  async function issueToken(user: User, options: { ttl?: number | string } = {}): Promise<string> {
    if (!jwtStrategy) throw new Error("auth.issueToken(): no jwt() strategy is configured");
    const ttlMs =
      options.ttl === undefined ? undefined : parseDuration(options.ttl, "issueToken ttl");
    return jwtStrategy.sign({ sub: user.id }, ttlMs);
  }

  async function issueTokens(user: User): Promise<IssueTokensResult> {
    if (!jwtStrategy) throw new Error("auth.issueTokens(): no jwt() strategy is configured");
    if (!opaqueStrategy) throw new Error("auth.issueTokens(): no opaque() strategy is configured");
    const familyId = randomToken();
    const { refreshToken } = await mintRefreshToken(user.id, familyId);
    const accessToken = await jwtStrategy.sign({ sub: user.id, fid: familyId });
    return { accessToken, refreshToken, expiresIn: Math.round(jwtStrategy.ttlMs / 1000) };
  }

  async function mintRefreshToken(
    userId: string,
    familyId: string,
  ): Promise<{ refreshToken: string }> {
    const strategy = opaqueStrategy as OpaqueStrategy<User>;
    const refreshToken = randomToken();
    const expiresAt = initialExpiry(strategy.ttlMs, strategy.absoluteMs);
    await adapter.createSession({
      tokenHash: hashToken(refreshToken),
      userId,
      familyId,
      expiresAt,
    });
    return { refreshToken };
  }

  const GRACE_MS = 30_000;

  /**
   * The pair minted at each rotation, keyed by the *old* token's hash, so a
   * client that presents an already-rotated token again inside the grace
   * window gets back the identical pair rather than a fresh one (the brief
   * requires "the same new pair", not just "a valid one"). The adapter has
   * nowhere to store this, so it lives in process memory: it only needs to
   * survive `GRACE_MS`, and losing it after a restart just means the next
   * replay inside the (now moot) grace window is treated as reuse instead,
   * which is the safe direction to fail in.
   */
  const rotationLog = new Map<string, { result: IssueTokensResult; mintedAt: number }>();

  function sweepRotationLog(): void {
    const cutoff = Date.now() - GRACE_MS;
    for (const [key, entry] of rotationLog) if (entry.mintedAt < cutoff) rotationLog.delete(key);
  }

  async function refresh(refreshToken: string): Promise<IssueTokensResult> {
    if (!jwtStrategy) throw new Error("auth.refresh(): no jwt() strategy is configured");
    if (!opaqueStrategy) throw new Error("auth.refresh(): no opaque() strategy is configured");
    sweepRotationLog();
    const tokenHash = hashToken(refreshToken);
    const session = await adapter.findSession(tokenHash);
    if (!session) throw new Unauthorized("Invalid refresh token");

    if (session.rotatedAt) {
      const age = Date.now() - session.rotatedAt.getTime();
      const replay = rotationLog.get(tokenHash);
      if (age <= GRACE_MS && replay) return replay.result;
      // Reuse of a rotated token, outside the grace window (or from another
      // process, which never saw the replay cache): treat as theft, revoke the family.
      await adapter.deleteSessionsByFamily(session.familyId);
      throw new Unauthorized("Refresh token already used; session revoked");
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await adapter.deleteSession(tokenHash);
      throw new Unauthorized("Refresh token expired");
    }

    const user = await adapter.findUserById(session.userId);
    if (!user) throw new Unauthorized("Invalid refresh token");

    await adapter.updateSession(tokenHash, { rotatedAt: new Date() });
    const { refreshToken: nextRefreshToken } = await mintRefreshToken(user.id, session.familyId);
    const accessToken = await jwtStrategy.sign({ sub: user.id, fid: session.familyId });
    const result: IssueTokensResult = {
      accessToken,
      refreshToken: nextRefreshToken,
      expiresIn: Math.round(jwtStrategy.ttlMs / 1000),
    };
    rotationLog.set(tokenHash, { result, mintedAt: Date.now() });
    return result;
  }

  return {
    require,
    optional,
    hashPassword: (password) => hasher.hash(password),
    verifyPassword,
    login,
    logout,
    logoutEverywhere,
    issueToken,
    issueTokens,
    refresh,
    csrf,
  };
}
