interface Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * The in-process backend: a `Map` with lazy expiry. Every read-modify-write
 * in the algorithms happens synchronously against it, with no `await` in
 * between, so it is atomic within a single process.
 */
export class MemoryStore {
  readonly #entries = new Map<string, Entry>();
  #sweeps = 0;

  get<T>(key: string, now: number): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlMs: number, now: number): void {
    this.#entries.set(key, { value, expiresAt: now + ttlMs });
    // Amortised cleanup so idle keys do not accumulate forever.
    if (++this.#sweeps % 1000 === 0) this.sweep(now);
  }

  sweep(now: number): void {
    for (const [key, entry] of this.#entries) if (entry.expiresAt <= now) this.#entries.delete(key);
  }

  get size(): number {
    return this.#entries.size;
  }
}
