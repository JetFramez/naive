/** A password hashing scheme: `scrypt()` (default, no native dependency) or `argon2()`. */
export interface PasswordHasher {
  readonly name: string;
  hash(password: string): Promise<string>;
  /** Constant-time comparison; never throws on a mismatched or malformed hash. */
  verify(hash: string, password: string): Promise<boolean>;
}
