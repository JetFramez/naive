import { parseDuration } from "@notio-internal/core";
import { hashToken, rollSession } from "../tokens.js";
import { absent, authenticated, type HasId, invalid, type Strategy } from "./types.js";

export interface OpaqueOptions {
  /** Milliseconds or a duration string. Default `"30d"`. */
  ttl?: number | string;
  rolling?: boolean;
  absolute?: number | string;
  /** Header the bearer token arrives in. Default `"authorization"` (as `Bearer <token>`). */
  header?: string;
}

/** An opaque strategy, carrying the resolved options `createAuth` needs for `issueTokens`/`refresh`. */
export interface OpaqueStrategy<User> extends Strategy<User, "opaque"> {
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
export function opaque<User extends HasId>(options: OpaqueOptions = {}): OpaqueStrategy<User> {
  const ttlMs = parseDuration(options.ttl ?? "30d", "opaque ttl");
  const rolling = options.rolling ?? true;
  const absoluteMs =
    options.absolute === undefined ? undefined : parseDuration(options.absolute, "opaque absolute");
  const header = (options.header ?? "authorization").toLowerCase();

  return {
    kind: "opaque",
    ttlMs,
    rolling,
    absoluteMs,
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
      const raw = ctx.headers.get(header);
      if (!raw) return absent();
      const token = header === "authorization" ? raw.replace(/^Bearer\s+/i, "") : raw;
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
  };
}
