/** A session or refresh-token record, keyed by the hash of the token the client holds. */
export interface SessionRecord {
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

export interface CreateSessionInput {
  readonly tokenHash: string;
  readonly userId: string;
  readonly familyId: string;
  readonly expiresAt: Date;
  readonly meta?: unknown;
}

export interface UpdateSessionInput {
  readonly expiresAt?: Date;
  readonly rotatedAt?: Date;
}

/**
 * Storage the auth module needs. Implement it against your database; every
 * strategy you configure only requires the subset of methods it uses, and
 * missing methods are reported together at `createAuth()`, not at first use.
 */
export interface AuthAdapter<User> {
  findUserById(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null>;
  createSession(input: CreateSessionInput): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  updateSession(tokenHash: string, changes: UpdateSessionInput): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsByFamily(familyId: string): Promise<void>;
  deleteSessionsByUser(userId: string): Promise<void>;
}

export type AdapterMethod = keyof AuthAdapter<unknown>;

export interface AdapterRequirement {
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
export function checkAdapter(
  adapter: AuthAdapter<unknown>,
  requirements: readonly AdapterRequirement[],
): void {
  const missing: string[] = [];
  for (const req of requirements) {
    const absent = req.methods.filter(
      (m) => typeof (adapter as unknown as Record<string, unknown>)[m] !== "function",
    );
    if (absent.length > 0) missing.push(`  - ${req.source}: missing ${absent.join(", ")}`);
  }
  if (missing.length > 0) {
    throw new Error(
      `createAuth(): the adapter is missing required methods:\n${missing.join("\n")}`,
    );
  }
}
