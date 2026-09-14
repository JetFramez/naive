import { parseDuration } from "@naive-internal/core";
import * as jose from "jose";
import { absent, authenticated, type HasId, invalid, type Strategy } from "./types.js";

export interface JwtKeyPair {
  privateKey: jose.CryptoKey | jose.KeyObject;
  publicKey: jose.CryptoKey | jose.KeyObject;
}

export interface JwtOptions {
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
export interface JwtStrategy<User> extends Strategy<User, "jwt"> {
  readonly ttlMs: number;
  sign(claims: Record<string, unknown>, ttlMs?: number): Promise<string>;
  verify(token: string): Promise<jose.JWTPayload>;
}

/**
 * Bearer auth on a signed JWT: stateless, no adapter session lookup, so it
 * cannot be revoked on its own (see `require(name, { verifySession })`).
 */
export function jwt<User extends HasId>(options: JwtOptions = {}): JwtStrategy<User> {
  if (options.secret && options.keys)
    throw new Error('jwt(): pass either "secret" or "keys", not both');
  if (options.keys && !options.algorithm) {
    throw new Error('jwt(): "algorithm" is required when using "keys"');
  }
  const algorithm = options.algorithm ?? "HS256";
  const ttlMs = parseDuration(options.ttl ?? "15m", "jwt ttl");
  const signingKey: Promise<jose.CryptoKey | jose.KeyObject | Uint8Array> = options.keys
    ? Promise.resolve(options.keys.privateKey)
    : Promise.resolve(new TextEncoder().encode(options.secret ?? throwNoSecret()));
  const verifyingKey: Promise<jose.CryptoKey | jose.KeyObject | Uint8Array> = options.keys
    ? Promise.resolve(options.keys.publicKey)
    : signingKey;

  async function sign(claims: Record<string, unknown>, overrideTtlMs?: number): Promise<string> {
    let builder = new jose.SignJWT(claims)
      .setProtectedHeader({ alg: algorithm })
      .setIssuedAt()
      .setExpirationTime(Math.floor((Date.now() + (overrideTtlMs ?? ttlMs)) / 1000));
    if (options.issuer !== undefined) builder = builder.setIssuer(options.issuer);
    if (options.audience !== undefined) builder = builder.setAudience(options.audience);
    return builder.sign(await signingKey);
  }

  async function verify(token: string): Promise<jose.JWTPayload> {
    const { payload } = await jose.jwtVerify(token, await verifyingKey, {
      algorithms: [algorithm],
      ...(options.issuer === undefined ? {} : { issuer: options.issuer }),
      ...(options.audience === undefined ? {} : { audience: options.audience }),
    });
    return payload;
  }

  return {
    kind: "jwt",
    ttlMs,
    sign,
    verify,
    requiredAdapterMethods: ["findUserById"],

    async authenticate(ctx, { adapter }) {
      const token = ctx.bearer();
      if (!token) return absent();
      let payload: jose.JWTPayload;
      try {
        payload = await verify(token);
      } catch {
        return invalid();
      }
      if (typeof payload.sub !== "string") return invalid();
      const user = await adapter.findUserById(payload.sub);
      return user ? authenticated(user) : invalid();
    },
  };
}

function throwNoSecret(): never {
  throw new Error('jwt(): pass "secret" or "keys"');
}
