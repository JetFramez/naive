import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

/**
 * Creates the SQLite file and tables if they don't exist yet. A real app
 * would use `drizzle-kit` migrations; a single `CREATE TABLE IF NOT EXISTS`
 * keeps this example self-contained and runnable with no setup step.
 */
export function createDb(path: string) {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      rotated_at INTEGER,
      created_at INTEGER NOT NULL
    );
  `);
  return drizzle(sqlite, { schema });
}

export type AppDatabase = ReturnType<typeof createDb>;
