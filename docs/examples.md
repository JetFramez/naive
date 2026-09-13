# Examples

Two runnable apps live in the repository's `examples/` directory, type-checked in CI alongside the framework itself. Run either with `pnpm --filter <name> start` from the repo root; each README has the exact commands.

## minimal

The smallest useful notio app: one router, a validated body, a thrown error rendered in the unified shape. Start here if you haven't read [Your first app](/guide/getting-started/first-app) yet — this is the same code, in full.

### A route with no schema, and a thrown error

```ts
curl http://localhost:3000/orders/1        # -> 200 { "id": "1", "total": 42 }
curl http://localhost:3000/orders/999      # -> 404, unified error shape
```

<<< ../examples/minimal/src/index.ts#get-route

### A validated body

```ts
curl -X POST http://localhost:3000/orders -H 'content-type: application/json' -d '{"total": 10}'
# -> 201 { "id": "2", "total": 10 }

curl -X POST http://localhost:3000/orders -H 'content-type: application/json' -d '{"total": -5}'
# -> 422, VALIDATION
```

<<< ../examples/minimal/src/index.ts#post-route

### Wiring it up

<<< ../examples/minimal/src/index.ts#wiring

Full source: [`examples/minimal/src/index.ts`](https://github.com/jetframez/notio/blob/main/examples/minimal/src/index.ts).

## auth-drizzle

`@jetframez/notio/auth` wired to a real database: an `AuthAdapter` implemented on Drizzle ORM against SQLite, backing signup, login, `GET /me`, and logout. Read [Auth](/guide/modules/auth) alongside this for what each piece means.

### The adapter

`AuthAdapter<User>` is a plain interface — no base class, no decorators. This implementation is Drizzle over SQLite; a Postgres or MySQL adapter looks the same shape, with real `await`s.

<<< ../examples/auth-drizzle/src/adapter.ts#user-interface

Session methods store one hashed token per row, shared by cookie sessions and any bearer/refresh tokens a real app adds later:

<<< ../examples/auth-drizzle/src/adapter.ts#session-methods

### Configuring auth

<<< ../examples/auth-drizzle/src/index.ts#setup

### Signup

Hashes the password, creates the user, then calls `auth.login()` to set the session cookie — the same call a login route makes, since both end in "this user now has a session."

<<< ../examples/auth-drizzle/src/index.ts#signup

### Login

`auth.verifyPassword()` throws `Unauthorized` on any mismatch — including an unknown email, which it treats identically in both response and timing. See [Auth: passwords](/guide/modules/auth#passwords).

<<< ../examples/auth-drizzle/src/index.ts#login

### A protected route

`auth.require("session")` narrows `ctx.user` to `User`, not `User | undefined` — the type reflects that this route can't be reached without one.

<<< ../examples/auth-drizzle/src/index.ts#me

### Running it

```sh
pnpm --filter auth-drizzle start

curl -c cookies.txt -X POST http://localhost:3000/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct horse","name":"Ada"}'

curl -b cookies.txt http://localhost:3000/auth/me

curl -b cookies.txt -X POST http://localhost:3000/auth/logout
```

The SQLite file and its tables are created automatically on first run. Full source: [`examples/auth-drizzle`](https://github.com/jetframez/notio/tree/main/examples/auth-drizzle).

## What's not covered by an example yet

Neither example touches uploads, rate limiting, OpenAPI, config, events, or cache directly — each of those modules' guide pages has its own complete, runnable-shaped snippet instead. If you're wiring several of these together in one app, the [recipes](/guide/guides/recipes) page has the combinations most likely to trip you up (auth plus rate limiting on a login route, in particular).
