# auth-drizzle

`notio/auth` wired to a real database: a Drizzle ORM `AuthAdapter` on SQLite, cookie sessions, and password hashing.

```sh
pnpm --filter auth-drizzle start

curl -c cookies.txt -X POST http://localhost:3000/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct horse","name":"Ada"}'

curl -b cookies.txt http://localhost:3000/auth/me

curl -b cookies.txt -X POST http://localhost:3000/auth/logout
```

`src/schema.ts` defines the `users` and `sessions` tables `AuthAdapter` needs; `src/adapter.ts` implements the interface against them with plain Drizzle queries. The database file (`auth-drizzle.sqlite`) and its tables are created automatically on first run — delete the file to start over.
