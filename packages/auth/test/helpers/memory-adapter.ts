import type {
  AuthAdapter,
  CreateSessionInput,
  SessionRecord,
  UpdateSessionInput,
} from "../../src/adapter.js";

export interface MemoryUser {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly name: string;
}

interface StoredSession extends SessionRecord {
  readonly tokenHash: string;
}

/**
 * An in-memory `AuthAdapter` for tests. `findSessionsByFamily` is an
 * additive extra beyond the brief's literal interface, used by
 * `require(name, { verifySession: true })`.
 */
export class MemoryAdapter implements AuthAdapter<MemoryUser> {
  readonly users = new Map<string, MemoryUser>();
  readonly sessions = new Map<string, StoredSession>();

  addUser(user: MemoryUser): void {
    this.users.set(user.id, user);
  }

  async findUserById(id: string): Promise<MemoryUser | null> {
    return this.users.get(id) ?? null;
  }

  async findUserByEmail(email: string): Promise<(MemoryUser & { passwordHash: string }) | null> {
    for (const user of this.users.values()) if (user.email === email) return user;
    return null;
  }

  async createSession(input: CreateSessionInput): Promise<void> {
    this.sessions.set(input.tokenHash, {
      tokenHash: input.tokenHash,
      userId: input.userId,
      familyId: input.familyId,
      expiresAt: input.expiresAt,
      rotatedAt: null,
      createdAt: new Date(),
    });
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    return this.sessions.get(tokenHash) ?? null;
  }

  async updateSession(tokenHash: string, changes: UpdateSessionInput): Promise<void> {
    const existing = this.sessions.get(tokenHash);
    if (!existing) return;
    this.sessions.set(tokenHash, { ...existing, ...changes });
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async deleteSessionsByFamily(familyId: string): Promise<void> {
    for (const [hash, session] of this.sessions)
      if (session.familyId === familyId) this.sessions.delete(hash);
  }

  async deleteSessionsByUser(userId: string): Promise<void> {
    for (const [hash, session] of this.sessions)
      if (session.userId === userId) this.sessions.delete(hash);
  }

  async findSessionsByFamily(familyId: string): Promise<readonly SessionRecord[]> {
    return [...this.sessions.values()].filter((s) => s.familyId === familyId);
  }
}
