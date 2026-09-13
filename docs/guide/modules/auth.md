# Auth

`@jetframez/notio/auth` is deliberately minimal: strategies, sessions, JWTs, opaque tokens with rotation, and password hashing. There is no OAuth, no magic links, no 2FA, no email verification, no password reset, and no authorization model — build those on top with `currentUser()` and your own logic.

```ts
import { createAuth, cookieSession, jwt, apiKey } from "@jetframez/notio/auth";

export const auth = createAuth<User>({
  adapter: myAdapter,
  strategies: {
    session: cookieSession({ ttl: "30d" }),
    bearer: jwt({ secret: process.env.JWT_SECRET, ttl: "15m" }),
    apiKey: apiKey({ header: "x-api-key", verify: (key) => db.apiKeys.findUser(key) }),
  },
  default: "session",
});

router.get("/orders").use(auth.require("session", "bearer")).handle((ctx) => {
  ctx.user; // User, narrowed by Middleware<{ user: User }>
});
```

`User` must have an `id: string`, which is what lets sessions, JWTs and refresh tokens store and look up a user by a single, uniform key.

## The adapter

```ts
interface AuthAdapter<User> {
  findUserById(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null>;
  createSession(input: { tokenHash, userId, familyId, expiresAt, meta? }): Promise<void>;
  findSession(tokenHash: string): Promise<{ userId, familyId, expiresAt, rotatedAt } | null>;
  updateSession(tokenHash: string, changes: { expiresAt?, rotatedAt? }): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsByFamily(familyId: string): Promise<void>;
  deleteSessionsByUser(userId: string): Promise<void>;
}
```

One `session` table backs both interactive cookie sessions and opaque bearer/refresh tokens — they're the same shape, a hashed token pointing at a user and a family. `createAuth()` checks, at call time, that your adapter implements every method the strategies you configured actually need, and reports every missing method together:

```
Error: createAuth(): the adapter is missing required methods:
  - strategies.session: missing createSession, findSession
  - auth.verifyPassword(): missing findUserByEmail
```

`auth.verifyPassword()` is always checked, since it's always on the returned object regardless of which strategies you configure.

## Strategies

| Factory | Reads | Adapter needs |
|---|---|---|
| `cookieSession({ cookie, ttl, rolling, absolute, secure, sameSite, domain })` | a cookie | full session methods |
| `jwt({ secret \| keys, ttl, issuer, audience, algorithm })` | `Authorization: Bearer` | `findUserById` only — stateless |
| `opaque({ ttl, rolling, absolute, header })` | a bearer header (default `authorization`) | full session methods |
| `apiKey({ header \| query, verify })` | a header or query param | none — `verify` resolves the user itself |
| `custom(resolve, { login?, logout? })` | anything `resolve(ctx)` inspects | none |

`ttl`, `absolute` and durations everywhere accept milliseconds or a duration string. Rolling sessions and opaque tokens extend their expiry on use, throttled to one write per minute; `absolute` caps the lifetime from creation, enforced on renewal only when the adapter's session record carries a `createdAt` (an additive field beyond the literal adapter shape above — safe to omit, in which case `absolute` still bounds a session's initial expiry).

`jwt({ keys })` takes an already-imported key pair (see `jose`'s `importPKCS8`/`importSPKI`); `algorithm` is required in that case.

## `require()` and `optional()`

```ts
router.get("/x").use(auth.require()).handle(...);                    // the default strategy
router.get("/x").use(auth.require("bearer", "apiKey")).handle(...);  // first match wins, in order
router.get("/x").use(auth.optional()).handle((ctx) => ctx.user?.id); // ctx.user?: User
router.get("/x").use(auth.optional({ rejectInvalid: true })).handle(...);
```

`require()` throws `Unauthorized` (401) when none of the given strategies (or the default, with none given) succeed, and marks the returned middleware so tooling — the OpenAPI module — can see which strategies secure a route.

`optional()` always uses the default strategy. It leaves `ctx.user` unset when no credential was presented at all; when one was presented but didn't check out (expired, revoked, bad signature), it also leaves `ctx.user` unset unless `rejectInvalid: true`, in which case it throws.

### Re-checking a JWT's session

A JWT is stateless: once issued, `require("bearer")` accepts it until it expires, even if you call `logoutEverywhere()` in the meantime. `require("bearer", { verifySession: true })` closes that gap for tokens minted by `issueTokens()`, by confirming the refresh token's family is still alive:

```ts
router.get("/sensitive").use(auth.require("bearer", { verifySession: true })).handle(...);
```

This needs the adapter to implement an additional, optional method beyond the base interface — `findSessionsByFamily(familyId): Promise<SessionRecord[]>` — since checking "is this family still valid" is a read the base adapter shape has no way to express. Without it, a route using `verifySession` fails clearly at the first request, naming the missing method.

## Sessions

```ts
await auth.login(ctx, user);            // sets the session cookie (or calls a custom() login hook)
await auth.logout(ctx);                 // clears it
await auth.logoutEverywhere(user.id);   // revokes every session and refresh-token family for the user
```

`login`/`logout` operate on whichever configured strategy actually implements them — `cookieSession()` always does; `custom()` does when given `login`/`logout` options. With neither configured, calling them throws immediately, naming what's missing.

## Passwords

```ts
const passwordHash = await auth.hashPassword(password);   // store this
const user = await auth.verifyPassword(email, password);  // throws Unauthorized on any mismatch
```

`verifyPassword` hashes a dummy password even when the email is unknown, so a wrong password and an unknown account take the same time to reject. Default hashing is `scrypt()` (Node's built-in, no native dependency); `argon2()` is available behind the optional `@node-rs/argon2` package:

```ts
import { argon2 } from "@jetframez/notio/auth";
createAuth({ hash: argon2(), /* ... */ });
```

## JWTs and refresh tokens

```ts
const token = await auth.issueToken(user);                 // a single JWT, no session record
const { accessToken, refreshToken, expiresIn } = await auth.issueTokens(user);  // needs jwt() + opaque()
const rotated = await auth.refresh(refreshToken);
```

`issueTokens`/`refresh` need both a `jwt()` strategy (for the access token) and an `opaque()` strategy (whose options govern the refresh token's lifetime) configured. `refresh()`:

- Rotates: the presented token is marked used, a new pair is minted in the same family.
- Replays: presenting the same already-rotated token again within a 30-second grace window returns the identical pair from the first rotation (not a new one), so a client that fired two requests in flight doesn't get logged out.
- Detects reuse: presenting a rotated token again outside the grace window revokes the entire family — a rotated token appearing twice means it was copied.

## CSRF

```ts
router.use(auth.csrf());
```

Double-submit cookie: issues a token cookie on any request that lacks one, and requires state-changing requests (everything but `GET`/`HEAD`/`OPTIONS` by default) to echo it back in an `X-CSRF-Token` header. Pair with `cookieSession()`; token-based strategies don't need it.

## Reading the current user anywhere

```ts
import { currentUser, requireUser } from "@jetframez/notio/auth";

currentUser<User>();   // User | undefined, via ALS — works outside handlers too
requireUser<User>();   // throws Unauthorized if there is none
```
