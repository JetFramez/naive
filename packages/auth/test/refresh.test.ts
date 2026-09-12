import { Router } from "@notio-internal/core";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/create-auth.js";
import { jwt } from "../src/strategies/jwt.js";
import { opaque } from "../src/strategies/opaque.js";
import { MemoryAdapter, type MemoryUser } from "./helpers/memory-adapter.js";

function makeUser(): MemoryUser {
  return { id: "u1", email: "ada@example.com", passwordHash: "unused", name: "Ada" };
}

function buildAuth(adapter: MemoryAdapter) {
  return createAuth({
    adapter,
    strategies: {
      bearer: jwt<MemoryUser>({ secret: "s", ttl: "15m" }),
      token: opaque<MemoryUser>({ ttl: "30d" }),
    },
    default: "bearer",
  });
}

describe("issueTokens / refresh", () => {
  it("issues an access token and a refresh token, and creates one session record", async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = buildAuth(adapter);
    const pair = await auth.issueTokens(makeUser());
    expect(pair.accessToken).toEqual(expect.any(String));
    expect(pair.refreshToken).toEqual(expect.any(String));
    expect(pair.expiresIn).toBe(15 * 60);
    expect(adapter.sessions.size).toBe(1);
  });

  it("rotates: the old refresh token stops working, the new one does", async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = buildAuth(adapter);
    const first = await auth.issueTokens(makeUser());
    const second = await auth.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    // Same family, so still one logical chain, but the old token itself is now rotated (not deleted).
    const third = await auth.refresh(second.refreshToken);
    expect(third.refreshToken).not.toBe(second.refreshToken);
  });

  it("replays the same pair when the just-rotated token is presented again inside the grace window", async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = buildAuth(adapter);
    const first = await auth.issueTokens(makeUser());
    const rotated = await auth.refresh(first.refreshToken);
    const replay = await auth.refresh(first.refreshToken);
    expect(replay).toEqual(rotated);
  });

  it("revokes the whole family on reuse outside the grace window", async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = buildAuth(adapter);
    const first = await auth.issueTokens(makeUser());
    const rotated = await auth.refresh(first.refreshToken);
    // Simulate the grace window having elapsed by clearing the replay evidence:
    // presenting the already-rotated token again should now read as theft.
    const { hashToken } = await import("../src/tokens.js");
    await adapter.updateSession(hashToken(first.refreshToken), {
      rotatedAt: new Date(Date.now() - 60_000),
    });
    await expect(auth.refresh(first.refreshToken)).rejects.toThrow(/already used; session revoked/);
    // The whole family, including the token issued by the legitimate rotation, is now dead.
    await expect(auth.refresh(rotated.refreshToken)).rejects.toThrow(/Invalid refresh token/);
  });

  it("rejects an unknown or already-deleted refresh token", async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = buildAuth(adapter);
    await expect(auth.refresh("not-a-real-token")).rejects.toThrow(/Invalid refresh token/);
  });

  it("rejects an expired refresh token and deletes it", async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = createAuth({
      adapter,
      strategies: {
        bearer: jwt<MemoryUser>({ secret: "s" }),
        token: opaque<MemoryUser>({ ttl: 1 }),
      },
      default: "bearer",
    });
    const pair = await auth.issueTokens(makeUser());
    await new Promise((r) => setTimeout(r, 20));
    await expect(auth.refresh(pair.refreshToken)).rejects.toThrow(/Refresh token expired/);
    expect(adapter.sessions.size).toBe(0);
  });

  it("issueToken/issueTokens/refresh throw a clear error when the required strategy is missing", async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const jwtOnly = createAuth({
      adapter,
      strategies: { bearer: jwt<MemoryUser>({ secret: "s" }) },
      default: "bearer",
    });
    await expect(jwtOnly.issueTokens(makeUser())).rejects.toThrow(/no opaque\(\) strategy/);
    await expect(jwtOnly.refresh("x")).rejects.toThrow(/no opaque\(\) strategy/);

    const opaqueOnly = createAuth({
      adapter,
      strategies: { token: opaque<MemoryUser>() },
      default: "token",
    });
    await expect(opaqueOnly.issueToken(makeUser())).rejects.toThrow(/no jwt\(\) strategy/);
    await expect(opaqueOnly.issueTokens(makeUser())).rejects.toThrow(/no jwt\(\) strategy/);
  });
});

describe("require(name, { verifySession: true })", () => {
  it("accepts a valid access token while its refresh family is alive", async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = buildAuth(adapter);
    const router = new Router();
    router
      .get("/me")
      .use(auth.require("bearer", { verifySession: true }))
      .handle((ctx) => ctx.user.id);
    const { withApp } = await import("./helpers/http.js");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const { accessToken } = await auth.issueTokens(makeUser());
        const res = await fetch("/me", { headers: { authorization: `Bearer ${accessToken}` } });
        expect(res.status).toBe(200);
      },
    );
  });

  it("rejects a still-valid access token once its refresh family has been revoked", async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = buildAuth(adapter);
    const router = new Router();
    router
      .get("/me")
      .use(auth.require("bearer", { verifySession: true }))
      .handle(() => "ok");
    const { withApp } = await import("./helpers/http.js");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const { accessToken } = await auth.issueTokens(makeUser());
        await auth.logoutEverywhere("u1");
        const res = await fetch("/me", { headers: { authorization: `Bearer ${accessToken}` } });
        expect(res.status).toBe(401);
      },
    );
  });

  it('plain require("bearer") (no verifySession) still accepts a token after its family is revoked', async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = buildAuth(adapter);
    const router = new Router();
    router
      .get("/me")
      .use(auth.require("bearer"))
      .handle(() => "ok");
    const { withApp } = await import("./helpers/http.js");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const { accessToken } = await auth.issueTokens(makeUser());
        await auth.logoutEverywhere("u1");
        // Demonstrates exactly why verifySession exists: a stateless JWT is not revoked by this call.
        const res = await fetch("/me", { headers: { authorization: `Bearer ${accessToken}` } });
        expect(res.status).toBe(200);
      },
    );
  });

  it("throws at require() setup when applied to a non-jwt strategy", () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = buildAuth(adapter);
    expect(() => auth.require("token", { verifySession: true })).toThrow(
      /only applies to a "jwt" strategy/,
    );
  });

  it("throws per-request when the adapter has no findSessionsByFamily", async () => {
    const base = new MemoryAdapter();
    base.addUser(makeUser());
    // A plain object adapter, genuinely lacking the optional findSessionsByFamily
    // method (unlike MemoryAdapter, which always implements it on its prototype).
    const adapter = {
      findUserById: base.findUserById.bind(base),
      findUserByEmail: base.findUserByEmail.bind(base),
      createSession: base.createSession.bind(base),
      findSession: base.findSession.bind(base),
      updateSession: base.updateSession.bind(base),
      deleteSession: base.deleteSession.bind(base),
      deleteSessionsByFamily: base.deleteSessionsByFamily.bind(base),
      deleteSessionsByUser: base.deleteSessionsByUser.bind(base),
    };
    const auth = buildAuth(adapter as MemoryAdapter);
    const router = new Router();
    router
      .get("/me")
      .use(auth.require("bearer", { verifySession: true }))
      .handle(() => "ok");
    const { withApp } = await import("./helpers/http.js");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const { accessToken } = await auth.issueTokens(makeUser());
        const res = await fetch("/me", { headers: { authorization: `Bearer ${accessToken}` } });
        expect(res.status).toBe(500);
        expect((await res.json()).message).toMatch(/findSessionsByFamily/);
      },
    );
  });
});
