import Keyv from "keyv";
import { beforeEach, describe, expect, it } from "vitest";
import { fixedWindow, slidingWindow, tokenBucket } from "../src/algorithms.js";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

let store: Keyv;
beforeEach(() => {
  store = new Keyv();
});

describe("fixedWindow", () => {
  it("allows up to the limit, then rejects within the same window", async () => {
    const opts = { store, key: "a", limit: 3, windowMs: 200, cost: 1 };
    expect((await fixedWindow(opts)).allowed).toBe(true);
    expect((await fixedWindow(opts)).allowed).toBe(true);
    const third = await fixedWindow(opts);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = await fixedWindow(opts);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", async () => {
    const opts = { store, key: "b", limit: 1, windowMs: 40, cost: 1 };
    expect((await fixedWindow(opts)).allowed).toBe(true);
    expect((await fixedWindow(opts)).allowed).toBe(false);
    await tick(60);
    expect((await fixedWindow(opts)).allowed).toBe(true);
  });

  it("respects a per-call cost", async () => {
    const opts = { store, key: "c", limit: 5, windowMs: 200, cost: 3 };
    const first = await fixedWindow(opts);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);
    const second = await fixedWindow({ ...opts, cost: 3 });
    expect(second.allowed).toBe(false);
    const third = await fixedWindow({ ...opts, cost: 2 });
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("keeps separate counters per key", async () => {
    const opts = { store, key: "x", limit: 1, windowMs: 200, cost: 1 };
    expect((await fixedWindow(opts)).allowed).toBe(true);
    expect((await fixedWindow({ ...opts, key: "y" })).allowed).toBe(true);
    expect((await fixedWindow(opts)).allowed).toBe(false);
  });
});

describe("slidingWindow", () => {
  it("allows up to the limit within one window", async () => {
    const opts = { store, key: "a", limit: 2, windowMs: 200, cost: 1 };
    expect((await slidingWindow(opts)).allowed).toBe(true);
    expect((await slidingWindow(opts)).allowed).toBe(true);
    expect((await slidingWindow(opts)).allowed).toBe(false);
  });

  it("carries a fraction of the previous window's usage forward", async () => {
    const opts = { store, key: "b", limit: 2, windowMs: 100, cost: 1 };
    // Fill the window, then cross into the next one; usage should not immediately reset to zero.
    expect((await slidingWindow(opts)).allowed).toBe(true);
    expect((await slidingWindow(opts)).allowed).toBe(true);
    await tick(105); // now in the next window
    const afterBoundary = await slidingWindow(opts);
    // A fresh fixed window would allow 2 more; the sliding approximation still
    // remembers most of the previous window's usage right after the boundary.
    expect(afterBoundary.remaining).toBeLessThan(2);
  });

  it("fully forgets usage once a full window has passed with no more activity", async () => {
    const opts = { store, key: "c", limit: 2, windowMs: 50, cost: 1 };
    expect((await slidingWindow(opts)).allowed).toBe(true);
    expect((await slidingWindow(opts)).allowed).toBe(true);
    await tick(120); // more than a full window with no activity
    const result = await slidingWindow(opts);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });
});

describe("tokenBucket", () => {
  it("allows a burst up to the limit, then throttles until tokens refill", async () => {
    const opts = { store, key: "a", limit: 3, windowMs: 300, cost: 1 };
    expect((await tokenBucket(opts)).allowed).toBe(true);
    expect((await tokenBucket(opts)).allowed).toBe(true);
    const third = await tokenBucket(opts);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = await tokenBucket(opts);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills gradually over the window rather than resetting all at once", async () => {
    const opts = { store, key: "b", limit: 10, windowMs: 100, cost: 10 };
    expect((await tokenBucket(opts)).allowed).toBe(true); // spend everything
    await tick(55); // roughly half the window: ~5 tokens back
    const half = await tokenBucket({ ...opts, cost: 4 });
    expect(half.allowed).toBe(true);
    const overspend = await tokenBucket({ ...opts, cost: 4 });
    expect(overspend.allowed).toBe(false);
  });

  it("never exceeds the limit's worth of stored capacity", async () => {
    const opts = { store, key: "c", limit: 5, windowMs: 30, cost: 1 };
    await tokenBucket(opts);
    await tick(200); // far longer than the window
    const result = await tokenBucket({ ...opts, cost: 5 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });
});
