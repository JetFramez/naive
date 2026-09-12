import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { fixedMemory, fixedRedis } from "../src/algorithms/fixed.js";
import { slidingMemory, slidingRedis } from "../src/algorithms/sliding.js";
import { tokenBucketMemory, tokenBucketRedis } from "../src/algorithms/token-bucket.js";
import { MemoryStore } from "../src/memory.js";
import type { ConsumeArgs, ConsumeResult, RedisLike } from "../src/types.js";

type Consume = (args: ConsumeArgs) => Promise<ConsumeResult> | ConsumeResult;

interface Backend {
  readonly name: string;
  make(): { fixed: Consume; sliding: Consume; tokenBucket: Consume };
}

const backends: Backend[] = [
  {
    name: "memory",
    make() {
      const store = new MemoryStore();
      return {
        fixed: (a) => fixedMemory(store, a),
        sliding: (a) => slidingMemory(store, a),
        tokenBucket: (a) => tokenBucketMemory(store, a),
      };
    },
  },
  {
    name: "redis (ioredis-mock, real Lua)",
    make() {
      const client = new RedisMock() as unknown as RedisLike;
      return {
        fixed: (a) => fixedRedis(client, a),
        sliding: (a) => slidingRedis(client, a),
        tokenBucket: (a) => tokenBucketRedis(client, a),
      };
    },
  },
];

// A controllable clock: every call passes `now` explicitly, so no real waiting.
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe.each(backends)("$name", (backend) => {
  let b: ReturnType<Backend["make"]>;
  beforeEach(() => {
    b = backend.make();
  });

  describe("fixed", () => {
    it("allows up to the limit, then rejects within the same window", async () => {
      const c = clock();
      const args = { key: "t:a", limit: 3, windowMs: 1000, cost: 1 };
      expect((await b.fixed({ ...args, now: c.now() })).allowed).toBe(true);
      expect((await b.fixed({ ...args, now: c.now() })).allowed).toBe(true);
      const third = await b.fixed({ ...args, now: c.now() });
      expect(third.allowed).toBe(true);
      expect(third.remaining).toBe(0);
      const fourth = await b.fixed({ ...args, now: c.now() });
      expect(fourth.allowed).toBe(false);
      expect(fourth.remaining).toBe(0);
      expect(fourth.retryAfterMs).toBeGreaterThan(0);
    });

    it("resets at the window boundary", async () => {
      const c = clock();
      const args = { key: "t:b", limit: 1, windowMs: 1000, cost: 1 };
      expect((await b.fixed({ ...args, now: c.now() })).allowed).toBe(true);
      expect((await b.fixed({ ...args, now: c.now() })).allowed).toBe(false);
      c.advance(1000);
      expect((await b.fixed({ ...args, now: c.now() })).allowed).toBe(true);
    });

    it("respects cost and keeps keys separate", async () => {
      const c = clock();
      const args = { key: "t:c", limit: 5, windowMs: 1000, now: c.now() };
      expect((await b.fixed({ ...args, cost: 3 })).remaining).toBe(2);
      expect((await b.fixed({ ...args, cost: 3 })).allowed).toBe(false);
      expect((await b.fixed({ ...args, key: "t:other", cost: 3 })).allowed).toBe(true);
    });

    it("counts concurrent requests exactly: no two see the same total", async () => {
      const now = clock().now();
      const args = { key: "t:conc", limit: 5, windowMs: 1000, cost: 1, now };
      const results = await Promise.all(Array.from({ length: 10 }, () => b.fixed(args)));
      expect(results.filter((r) => r.allowed)).toHaveLength(5);
    });
  });

  describe("sliding", () => {
    it("allows up to the limit within one window", async () => {
      const c = clock();
      const args = { key: "s:a", limit: 2, windowMs: 1000, cost: 1 };
      expect((await b.sliding({ ...args, now: c.now() })).allowed).toBe(true);
      expect((await b.sliding({ ...args, now: c.now() })).allowed).toBe(true);
      expect((await b.sliding({ ...args, now: c.now() })).allowed).toBe(false);
    });

    it("carries a fraction of the previous window forward, then forgets it", async () => {
      const c = clock();
      const args = { key: "s:b", limit: 2, windowMs: 1000, cost: 1 };
      await b.sliding({ ...args, now: c.now() });
      await b.sliding({ ...args, now: c.now() });
      c.advance(1000); // just past the boundary: previous window still weighs ~100%
      expect((await b.sliding({ ...args, now: c.now() })).allowed).toBe(false);
      c.advance(1000); // a full window later: previous window has fallen out
      const later = await b.sliding({ ...args, now: c.now() });
      expect(later.allowed).toBe(true);
    });

    it("counts concurrent requests exactly", async () => {
      const now = clock().now();
      const args = { key: "s:conc", limit: 4, windowMs: 1000, cost: 1, now };
      const results = await Promise.all(Array.from({ length: 10 }, () => b.sliding(args)));
      expect(results.filter((r) => r.allowed)).toHaveLength(4);
    });
  });

  describe("token-bucket", () => {
    it("allows a burst up to the limit, then throttles", async () => {
      const c = clock();
      const args = { key: "tb:a", limit: 3, windowMs: 3000, cost: 1 };
      expect((await b.tokenBucket({ ...args, now: c.now() })).allowed).toBe(true);
      expect((await b.tokenBucket({ ...args, now: c.now() })).allowed).toBe(true);
      const third = await b.tokenBucket({ ...args, now: c.now() });
      expect(third.allowed).toBe(true);
      expect(third.remaining).toBe(0);
      const fourth = await b.tokenBucket({ ...args, now: c.now() });
      expect(fourth.allowed).toBe(false);
      expect(fourth.retryAfterMs).toBe(1000); // one token refills every 1000ms
    });

    it("refills gradually rather than all at once", async () => {
      const c = clock();
      const args = { key: "tb:b", limit: 10, windowMs: 1000 };
      expect((await b.tokenBucket({ ...args, cost: 10, now: c.now() })).allowed).toBe(true);
      c.advance(500); // ~5 tokens back
      expect((await b.tokenBucket({ ...args, cost: 4, now: c.now() })).allowed).toBe(true);
      expect((await b.tokenBucket({ ...args, cost: 4, now: c.now() })).allowed).toBe(false);
    });

    it("never stores more than the limit's worth of capacity", async () => {
      const c = clock();
      const args = { key: "tb:c", limit: 5, windowMs: 100 };
      await b.tokenBucket({ ...args, cost: 1, now: c.now() });
      c.advance(10_000);
      const result = await b.tokenBucket({ ...args, cost: 5, now: c.now() });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it("spends concurrent requests exactly", async () => {
      const now = clock().now();
      const args = { key: "tb:conc", limit: 3, windowMs: 1000, cost: 1, now };
      const results = await Promise.all(Array.from({ length: 10 }, () => b.tokenBucket(args)));
      expect(results.filter((r) => r.allowed)).toHaveLength(3);
    });
  });
});
