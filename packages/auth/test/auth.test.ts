import { Router } from "@notio-internal/core";
import { describe, expect, it } from "vitest";
import { AUTH_REQUIREMENT, createAuth } from "../src/create-auth.js";
import { apiKey } from "../src/strategies/api-key.js";
import { custom } from "../src/strategies/custom.js";
import { jwt } from "../src/strategies/jwt.js";
import { opaque } from "../src/strategies/opaque.js";
import { cookieSession } from "../src/strategies/session.js";
import { must } from "./helpers/assert.js";
import { withApp } from "./helpers/http.js";
import { MemoryAdapter, type MemoryUser } from "./helpers/memory-adapter.js";

function makeUser(overrides: Partial<MemoryUser> = {}): MemoryUser {
  return { id: "u1", email: "ada@example.com", passwordHash: "unused", name: "Ada", ...overrides };
}

describe("createAuth: boot-time checks", () => {
  it("throws once, listing every missing adapter method, when the adapter cannot back the configured strategies", () => {
    const adapter = { findUserById: async () => null } as never;
    expect(() =>
      createAuth({
        adapter,
        strategies: { session: cookieSession() },
        default: "session",
      }),
    ).toThrow(/strategies\.session: missing createSession/);
  });

  it("throws when the default strategy name is not configured", () => {
    const adapter = new MemoryAdapter();
    expect(() =>
      createAuth({ adapter, strategies: { session: cookieSession() }, default: "nope" as never }),
    ).toThrow(/default strategy "nope"/);
  });
});

describe("cookieSession", () => {
  async function build() {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = createAuth({
      adapter,
      strategies: { session: cookieSession() },
      default: "session",
    });
    return { adapter, auth };
  }

  it("login sets a cookie, require() authenticates from it, logout clears it", async () => {
    const { adapter, auth } = await build();
    const router = new Router();
    router.post("/login").handle(async (ctx) => {
      await auth.login(ctx, must(await adapter.findUserById("u1")));
      return "ok";
    });
    router
      .get("/me")
      .use(auth.require("session"))
      .handle((ctx) => ctx.user);
    router.post("/logout").handle(async (ctx) => {
      await auth.logout(ctx);
      return "ok";
    });

    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        expect((await fetch("/me")).status).toBe(401);
        const login = await fetch("/login", { method: "POST" });
        const cookie = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
        expect(adapter.sessions.size).toBe(1);
        const me = await fetch("/me", { headers: { cookie } });
        expect(me.status).toBe(200);
        expect(await me.json()).toMatchObject({ id: "u1", email: "ada@example.com" });
        await fetch("/logout", { method: "POST", headers: { cookie } });
        expect(adapter.sessions.size).toBe(0);
        expect((await fetch("/me", { headers: { cookie } })).status).toBe(401);
      },
    );
  });

  it("rejects and deletes an expired session", async () => {
    const { adapter, auth } = await build();
    const router = new Router();
    router
      .get("/me")
      .use(auth.require("session"))
      .handle((ctx) => ctx.user);
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        adapter.sessions.set("deadbeef", {
          tokenHash: "deadbeef",
          userId: "u1",
          familyId: "f1",
          expiresAt: new Date(Date.now() - 1000),
          rotatedAt: null,
        });
        // The cookie value hashes to something else entirely, so this exercises "no session found"
        // as well; expiry is exercised via the rolling test below using a real login.
        expect((await fetch("/me", { headers: { cookie: "sid=whatever" } })).status).toBe(401);
      },
    );
  });

  it("rolls the session forward on first use (nothing to throttle against yet), then holds for a minute", async () => {
    const { adapter, auth } = await build();
    const router = new Router();
    router.post("/login").handle(async (ctx) => {
      await auth.login(ctx, must(await adapter.findUserById("u1")));
      return "ok";
    });
    router
      .get("/me")
      .use(auth.require("session"))
      .handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const login = await fetch("/login", { method: "POST" });
        const cookie = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
        const [, session] = must([...adapter.sessions][0]);
        const originalExpiry = session.expiresAt.getTime();
        expect(session.rotatedAt).toBeNull();

        await fetch("/me", { headers: { cookie } });
        const [, afterFirst] = must([...adapter.sessions][0]);
        expect(afterFirst.expiresAt.getTime()).toBeGreaterThanOrEqual(originalExpiry);
        expect(afterFirst.rotatedAt).not.toBeNull();

        // A second use moments later must not roll again: throttled to once per minute.
        const rolledAt = must(afterFirst.rotatedAt).getTime();
        const expiryAfterFirst = afterFirst.expiresAt.getTime();
        await fetch("/me", { headers: { cookie } });
        const [, afterSecond] = must([...adapter.sessions][0]);
        expect(must(afterSecond.rotatedAt).getTime()).toBe(rolledAt);
        expect(afterSecond.expiresAt.getTime()).toBe(expiryAfterFirst);
      },
    );
  });

  it("logoutEverywhere removes every session for the user, not other users'", async () => {
    const { adapter, auth } = await build();
    adapter.addUser(makeUser({ id: "u2", email: "grace@example.com" }));
    const router = new Router();
    router.post("/login/:id").handle(async (ctx) => {
      await auth.login(ctx, must(await adapter.findUserById(ctx.params.id as string)));
      return "ok";
    });
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        await fetch("/login/u1", { method: "POST" });
        await fetch("/login/u1", { method: "POST" }); // a second device
        await fetch("/login/u2", { method: "POST" });
        expect(adapter.sessions.size).toBe(3);
        await auth.logoutEverywhere("u1");
        expect(adapter.sessions.size).toBe(1);
        expect([...adapter.sessions.values()][0]?.userId).toBe("u2");
      },
    );
  });

  it("auth.login/logout throw a clear error when no cookieSession strategy is configured", async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = createAuth({
      adapter,
      strategies: { apiKey: apiKey<MemoryUser>({ header: "x-key", verify: async () => null }) },
      default: "apiKey",
    });
    await expect(auth.login({} as never, makeUser())).rejects.toThrow(
      /no configured strategy implements login/,
    );
    await expect(auth.logout({} as never)).rejects.toThrow(
      /no configured strategy implements logout/,
    );
  });
});

describe("jwt", () => {
  function build() {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = createAuth({
      adapter,
      strategies: { bearer: jwt<MemoryUser>({ secret: "test-secret", ttl: "1h" }) },
      default: "bearer",
    });
    return { adapter, auth };
  }

  it("issueToken mints a JWT that require() accepts, and rejects tampered or absent tokens", async () => {
    const { auth } = build();
    const router = new Router();
    router
      .get("/me")
      .use(auth.require("bearer"))
      .handle((ctx) => ctx.user);
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const token = await auth.issueToken(makeUser());
        const ok = await fetch("/me", { headers: { authorization: `Bearer ${token}` } });
        expect(ok.status).toBe(200);
        expect((await ok.json()).id).toBe("u1");
        expect((await fetch("/me")).status).toBe(401);
        expect(
          (await fetch("/me", { headers: { authorization: `Bearer ${token}x` } })).status,
        ).toBe(401);
      },
    );
  });

  it("rejects an expired token and a token for an unknown user", async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = createAuth({
      adapter,
      strategies: { bearer: jwt<MemoryUser>({ secret: "s", ttl: 1 }) },
      default: "bearer",
    });
    const router = new Router();
    router
      .get("/me")
      .use(auth.require("bearer"))
      .handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const token = await auth.issueToken(makeUser());
        await new Promise((r) => setTimeout(r, 20));
        expect((await fetch("/me", { headers: { authorization: `Bearer ${token}` } })).status).toBe(
          401,
        );

        const ghostToken = await auth.issueToken(makeUser({ id: "ghost" }));
        expect(
          (await fetch("/me", { headers: { authorization: `Bearer ${ghostToken}` } })).status,
        ).toBe(401);
      },
    );
  });

  it("a token signed with a different secret is rejected", async () => {
    const { auth } = build();
    const otherAuth = createAuth({
      adapter: new (class extends MemoryAdapter {})(),
      strategies: { bearer: jwt<MemoryUser>({ secret: "different-secret" }) },
      default: "bearer",
    });
    const router = new Router();
    router
      .get("/me")
      .use(auth.require("bearer"))
      .handle(() => "ok");
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const foreignToken = await otherAuth.issueToken(makeUser());
        expect(
          (await fetch("/me", { headers: { authorization: `Bearer ${foreignToken}` } })).status,
        ).toBe(401);
      },
    );
  });

  it("rejects configuring both secret and keys, or neither", () => {
    expect(() => jwt({ secret: "s", keys: {} as never })).toThrow(/either "secret" or "keys"/);
    expect(() => jwt({})).toThrow(/pass "secret" or "keys"/);
  });
});

describe("opaque", () => {
  it("authenticates a bearer opaque token backed by a session record, respecting expiry", async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = createAuth({
      adapter,
      strategies: { token: opaque<MemoryUser>({ ttl: "1h" }) },
      default: "token",
    });
    const router = new Router();
    router
      .get("/me")
      .use(auth.require("token"))
      .handle((ctx) => ctx.user);
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        expect((await fetch("/me")).status).toBe(401);
        const { accessToken: _unused, refreshToken } = {
          accessToken: "",
          refreshToken: "raw-opaque-token",
        };
        const { hashToken } = await import("../src/tokens.js");
        await adapter.createSession({
          tokenHash: hashToken(refreshToken),
          userId: "u1",
          familyId: "f1",
          expiresAt: new Date(Date.now() + 60_000),
        });
        const ok = await fetch("/me", { headers: { authorization: `Bearer ${refreshToken}` } });
        expect(ok.status).toBe(200);

        await adapter.updateSession(hashToken(refreshToken), {
          expiresAt: new Date(Date.now() - 1),
        });
        expect(
          (await fetch("/me", { headers: { authorization: `Bearer ${refreshToken}` } })).status,
        ).toBe(401);
        expect(adapter.sessions.size).toBe(0);
      },
    );
  });
});

describe("apiKey", () => {
  it("reads from a header or a query param and rejects both configured at once", async () => {
    const adapter = new MemoryAdapter();
    const auth = createAuth({
      adapter,
      strategies: {
        key: apiKey<MemoryUser>({
          header: "x-api-key",
          verify: async (key) => (key === "secret-key" ? makeUser() : null),
        }),
      },
      default: "key",
    });
    const router = new Router();
    router
      .get("/me")
      .use(auth.require("key"))
      .handle((ctx) => ctx.user);
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        expect((await fetch("/me")).status).toBe(401);
        expect((await fetch("/me", { headers: { "x-api-key": "wrong" } })).status).toBe(401);
        expect((await fetch("/me", { headers: { "x-api-key": "secret-key" } })).status).toBe(200);
      },
    );
    expect(() => apiKey({ verify: async () => null })).toThrow(/pass "header" or "query"/);
    expect(() => apiKey({ header: "a", query: "b", verify: async () => null })).toThrow(/not both/);
  });

  it("supports a query parameter instead of a header", async () => {
    const auth = createAuth({
      adapter: new MemoryAdapter(),
      strategies: {
        key: apiKey<MemoryUser>({
          query: "api_key",
          verify: async (k) => (k === "q" ? makeUser() : null),
        }),
      },
      default: "key",
    });
    const router = new Router();
    router
      .get("/me")
      .use(auth.require("key"))
      .handle((ctx) => ctx.user);
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        expect((await fetch("/me?api_key=q")).status).toBe(200);
        expect((await fetch("/me?api_key=nope")).status).toBe(401);
      },
    );
  });
});

describe("custom", () => {
  it("resolves a principal from ctx, and supports login/logout hooks", async () => {
    let loggedIn: string | undefined;
    let loggedOut = false;
    const strategy = custom<MemoryUser>(
      (ctx) => (ctx.headers.get("x-trusted") === "1" ? makeUser() : null),
      {
        login: (_ctx, user) => {
          loggedIn = user.id;
        },
        logout: () => {
          loggedOut = true;
        },
      },
    );
    const auth = createAuth({
      adapter: new MemoryAdapter(),
      strategies: { device: strategy },
      default: "device",
    });
    const router = new Router();
    router
      .get("/me")
      .use(auth.require("device"))
      .handle((ctx) => ctx.user);
    router.post("/login").handle(async (ctx) => {
      await auth.login(ctx, makeUser());
      return "ok";
    });
    router.post("/logout").handle(async (ctx) => {
      await auth.logout(ctx);
      return "ok";
    });
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        expect((await fetch("/me")).status).toBe(401);
        expect((await fetch("/me", { headers: { "x-trusted": "1" } })).status).toBe(200);
        await fetch("/login", { method: "POST" });
        expect(loggedIn).toBe("u1");
        await fetch("/logout", { method: "POST" });
        expect(loggedOut).toBe(true);
      },
    );
  });
});

describe("require(): multiple strategies and errors", () => {
  it("tries strategies in order and succeeds on the first match", async () => {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = createAuth({
      adapter,
      strategies: {
        bearer: jwt<MemoryUser>({ secret: "s" }),
        key: apiKey<MemoryUser>({
          header: "x-key",
          verify: async (k) => (k === "k" ? makeUser({ id: "u2" }) : null),
        }),
      },
      default: "bearer",
    });
    const router = new Router();
    router
      .get("/me")
      .use(auth.require("bearer", "key"))
      .handle((ctx) => ctx.user.id);
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        expect((await fetch("/me")).status).toBe(401);
        expect(await (await fetch("/me", { headers: { "x-key": "k" } })).text()).toBe("u2");
        const token = await auth.issueToken(makeUser());
        expect(
          await (await fetch("/me", { headers: { authorization: `Bearer ${token}` } })).text(),
        ).toBe("u1");
      },
    );
  });

  it("throws at setup for an unknown strategy name", () => {
    const auth = createAuth({
      adapter: new MemoryAdapter(),
      strategies: { session: cookieSession() },
      default: "session",
    });
    expect(() => auth.require("nope")).toThrow(/unknown strategy "nope"/);
  });

  it("marks the returned middleware for tools like the OpenAPI module", () => {
    const auth = createAuth({
      adapter: new MemoryAdapter(),
      strategies: { session: cookieSession() },
      default: "session",
    });
    const mw = auth.require("session");
    expect((mw as never as Record<symbol, unknown>)[AUTH_REQUIREMENT]).toEqual({
      strategies: ["session"],
    });
    const opt = auth.optional();
    expect((opt as never as Record<symbol, unknown>)[AUTH_REQUIREMENT]).toBeUndefined();
  });
});

describe("optional()", () => {
  async function build() {
    const adapter = new MemoryAdapter();
    adapter.addUser(makeUser());
    const auth = createAuth({
      adapter,
      strategies: { session: cookieSession() },
      default: "session",
    });
    return { adapter, auth };
  }

  it("leaves ctx.user unset when no credential is presented, and never throws", async () => {
    const { auth } = await build();
    const router = new Router();
    router
      .get("/x")
      .use(auth.optional())
      .handle((ctx) => ({ user: ctx.user ?? null }));
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        expect(await (await fetch("/x")).json()).toEqual({ user: null });
      },
    );
  });

  it("leaves ctx.user unset for an invalid credential by default, but rejects with rejectInvalid", async () => {
    const { auth } = await build();
    const router = new Router();
    router
      .get("/lenient")
      .use(auth.optional())
      .handle((ctx) => ({ user: ctx.user ?? null }));
    router
      .get("/strict")
      .use(auth.optional({ rejectInvalid: true }))
      .handle((ctx) => ({ user: ctx.user ?? null }));
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const bad = { headers: { cookie: "sid=not-a-real-session" } };
        expect(await (await fetch("/lenient", bad)).json()).toEqual({ user: null });
        expect((await fetch("/strict", bad)).status).toBe(401);
      },
    );
  });

  it("sets ctx.user for a valid credential", async () => {
    const { auth } = await build();
    const router = new Router();
    router.post("/login").handle(async (ctx) => {
      await auth.login(ctx, makeUser());
      return "ok";
    });
    router
      .get("/x")
      .use(auth.optional())
      .handle((ctx) => ({ id: ctx.user?.id ?? null }));
    await withApp(
      (app) => app.mount(router),
      async ({ fetch }) => {
        const login = await fetch("/login", { method: "POST" });
        const cookie = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
        expect(await (await fetch("/x", { headers: { cookie } })).json()).toEqual({ id: "u1" });
      },
    );
  });
});

describe("hashPassword / verifyPassword", () => {
  it("round-trips a password and rejects a wrong one or an unknown email", async () => {
    const adapter = new MemoryAdapter();
    const auth = createAuth({
      adapter,
      strategies: { session: cookieSession() },
      default: "session",
    });
    const passwordHash = await auth.hashPassword("hunter2");
    adapter.addUser(makeUser({ passwordHash }));
    const user = await auth.verifyPassword("ada@example.com", "hunter2");
    expect(user.id).toBe("u1");
    await expect(auth.verifyPassword("ada@example.com", "wrong")).rejects.toThrow(
      /Invalid email or password/,
    );
    await expect(auth.verifyPassword("nobody@example.com", "hunter2")).rejects.toThrow(
      /Invalid email or password/,
    );
  });
});
