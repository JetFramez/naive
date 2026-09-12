# Examples

Two runnable apps live in the repository's `examples/` directory, type-checked in CI alongside the framework itself. Run either with `pnpm --filter <name> start` from the repo root.

## minimal

The smallest useful notio app: one router, a validated body, a thrown error rendered in the unified shape.

<<< ../examples/minimal/src/index.ts

## auth-drizzle

`@jetframez/notio/auth` wired to a real database: an `AuthAdapter` implemented on Drizzle ORM against SQLite, backing signup, login, `GET /me`, and logout.

### The adapter

<<< ../examples/auth-drizzle/src/adapter.ts

### The routes

<<< ../examples/auth-drizzle/src/index.ts
