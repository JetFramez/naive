import { eq } from "drizzle-orm";
import type { AuthAdapter } from "notio/auth";
import type { AppDatabase } from "./db.js";
import { sessions, users } from "./schema.js";

// #region user-interface
export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}
// #endregion user-interface

/**
 * `AuthAdapter<User>` on Drizzle + SQLite. Every method is declared `async`
 * to satisfy the interface even though `better-sqlite3` is a synchronous
 * driver underneath — a Postgres or MySQL adapter would `await` for real.
 */
export function createDrizzleAdapter(db: AppDatabase): AuthAdapter<User> {
  return {
    async findUserById(id) {
      const row = db.select().from(users).where(eq(users.id, id)).get();
      return row ? { id: row.id, email: row.email, name: row.name } : null;
    },

    async findUserByEmail(email) {
      const row = db.select().from(users).where(eq(users.email, email)).get();
      return row
        ? { id: row.id, email: row.email, name: row.name, passwordHash: row.passwordHash }
        : null;
    },

    // #region session-methods
    async createSession({ tokenHash, userId, familyId, expiresAt }) {
      db.insert(sessions).values({ tokenHash, userId, familyId, expiresAt, rotatedAt: null }).run();
    },

    async findSession(tokenHash) {
      const row = db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).get();
      if (!row) return null;
      return {
        userId: row.userId,
        familyId: row.familyId,
        expiresAt: row.expiresAt,
        rotatedAt: row.rotatedAt,
        createdAt: row.createdAt,
      };
    },
    // #endregion session-methods

    async updateSession(tokenHash, changes) {
      db.update(sessions).set(changes).where(eq(sessions.tokenHash, tokenHash)).run();
    },

    async deleteSession(tokenHash) {
      db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
    },

    async deleteSessionsByFamily(familyId) {
      db.delete(sessions).where(eq(sessions.familyId, familyId)).run();
    },

    async deleteSessionsByUser(userId) {
      db.delete(sessions).where(eq(sessions.userId, userId)).run();
    },
  };
}
