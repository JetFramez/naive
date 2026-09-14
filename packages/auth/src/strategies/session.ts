import type { CookieOptions } from "@naive-internal/core";
import { parseDuration } from "@naive-internal/core";
import { hashToken, initialExpiry, randomToken, rollSession } from "../tokens.js";
import { absent, authenticated, type HasId, invalid, type Strategy } from "./types.js";

export interface CookieSessionOptions {
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
export function cookieSession<User extends HasId>(
  options: CookieSessionOptions = {},
): Strategy<User, "session"> {
  const cookieName = options.cookie ?? "sid";
  const ttlMs = parseDuration(options.ttl ?? "30d", "session ttl");
  const rolling = options.rolling ?? true;
  const absoluteMs =
    options.absolute === undefined
      ? undefined
      : parseDuration(options.absolute, "session absolute");
  const cookieOptions: CookieOptions = {
    ...(options.secure === undefined ? {} : { secure: options.secure }),
    sameSite: options.sameSite ?? "lax",
    ...(options.domain === undefined ? {} : { domain: options.domain }),
  };

  return {
    kind: "session",
    requiredAdapterMethods: [
      "findUserById",
      "createSession",
      "findSession",
      "updateSession",
      "deleteSession",
      "deleteSessionsByFamily",
      "deleteSessionsByUser",
    ],

    async authenticate(ctx, { adapter }) {
      const token = ctx.cookies.get(cookieName);
      if (!token) return absent();
      const tokenHash = hashToken(token);
      const session = await adapter.findSession(tokenHash);
      if (!session) return invalid();
      if (session.expiresAt.getTime() <= Date.now()) {
        await adapter.deleteSession(tokenHash);
        return invalid();
      }
      const user = await adapter.findUserById(session.userId);
      if (!user) return invalid();
      if (rolling) await rollSession(adapter, tokenHash, session, ttlMs, absoluteMs);
      return authenticated(user);
    },

    async login(ctx, user, { adapter }) {
      const token = randomToken();
      const tokenHash = hashToken(token);
      const expiresAt = initialExpiry(ttlMs, absoluteMs);
      await adapter.createSession({
        tokenHash,
        userId: user.id,
        familyId: randomToken(),
        expiresAt,
      });
      ctx.cookies.set(cookieName, token, {
        ...cookieOptions,
        maxAge: expiresAt.getTime() - Date.now(),
      });
    },

    async logout(ctx, { adapter }) {
      const token = ctx.cookies.get(cookieName);
      if (token) await adapter.deleteSession(hashToken(token)).catch(() => {});
      const { secure: _secure, sameSite: _sameSite, ...deleteOptions } = cookieOptions;
      ctx.cookies.delete(cookieName, deleteOptions);
    },

    async logoutEverywhere(userId, { adapter }) {
      await adapter.deleteSessionsByUser(userId);
    },
  };
}
