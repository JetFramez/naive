import { createHash, randomBytes } from "node:crypto";
import type { AuthAdapter, SessionRecord } from "./adapter.js";

/** A random, URL-safe opaque token. Never stored directly; only its hash is. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** The form an opaque token or session cookie value takes in storage. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Sessions roll forward at most this often, regardless of how many requests arrive. */
export const ROLL_THROTTLE_MS = 60_000;

/**
 * Extends a session's expiry when it is due (rolling, throttled to one write
 * per minute), capped by `absoluteMs` from the session's `createdAt` when the
 * adapter reports one.
 */
export async function rollSession(
  adapter: Pick<AuthAdapter<unknown>, "updateSession">,
  tokenHash: string,
  session: SessionRecord,
  ttlMs: number,
  absoluteMs: number | undefined,
): Promise<void> {
  const now = Date.now();
  const lastRoll = session.rotatedAt?.getTime() ?? 0;
  if (now - lastRoll < ROLL_THROTTLE_MS) return;
  let expiresAt = now + ttlMs;
  if (absoluteMs !== undefined && session.createdAt) {
    expiresAt = Math.min(expiresAt, session.createdAt.getTime() + absoluteMs);
  }
  if (expiresAt <= session.expiresAt.getTime()) return;
  await adapter.updateSession(tokenHash, {
    expiresAt: new Date(expiresAt),
    rotatedAt: new Date(now),
  });
}

/** The initial expiry for a new session/token, bounded by `absolute` when given. */
export function initialExpiry(ttlMs: number, absoluteMs: number | undefined): Date {
  const now = Date.now();
  return new Date(absoluteMs === undefined ? now + ttlMs : now + Math.min(ttlMs, absoluteMs));
}
