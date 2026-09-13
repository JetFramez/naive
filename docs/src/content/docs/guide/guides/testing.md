---
title: Testing
---

notio ships no test client — see [What notio does not do](/guide/about/scope). Testing a notio app is testing an Express app: start it on an ephemeral port and make real requests. This is the same pattern the framework's own test suite uses.

## Starting and stopping the app

Bind to port `0` for an OS-assigned free port, and disable signal handling so `close()` is something you call, not something that fires on `SIGTERM`:

```ts
import type { AddressInfo } from "node:net";
import type { App } from "@jetframez/notio";

async function startTestApp(app: App) {
  const server = await app.listen(0, "127.0.0.1");
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  return {
    fetch: (path: string, init?: RequestInit) => fetch(`${base}${path}`, init),
    close: () => app.close(),
  };
}
```

```ts
import { createApp, Router } from "@jetframez/notio";

const app = createApp({ shutdown: { signals: false } });
app.mount(orders);

const server = await startTestApp(app);
try {
  const res = await server.fetch("/orders/1");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: "1", total: 42 });
} finally {
  await server.close();
}
```

Plain `fetch` is enough — no `supertest` dependency needed. Pass `{ redirect: "manual" }` in the wrapper above if you're asserting on a 3xx response, since `fetch` follows redirects by default.

## Capturing logs instead of asserting against stdout

Pass a `destination` that collects lines in memory rather than writing them:

```ts
import { createLogger } from "@jetframez/notio";

function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    pretty: false,
    destination: {
      write(chunk: string) {
        for (const line of chunk.split("\n")) if (line.trim()) lines.push(JSON.parse(line));
      },
    },
  });
  return { logger, lines };
}

const { logger, lines } = captureLogger();
const app = createApp({ logger, shutdown: { signals: false } });
// ... make requests ...
expect(lines.some((l) => l.msg === "order placed")).toBe(true);
```

## Config overrides

`defineConfig({ overrides })` takes precedence over every other source, including `process.env` — use it to set exactly the values a test needs without touching real environment variables or `.env` files:

```ts
const config = defineConfig({
  port: env.port({ default: 3000 }),
  database: { url: env.url() },
}, {
  overrides: { database: { url: "postgres://localhost/test" } },
});
```

See [Config: where values come from](/guide/core/config#where-values-come-from) for the full precedence order.

## Testing thrown errors and validation

Because errors render through the unified envelope, asserting on them is asserting on a JSON body and a status code, not on an exception type:

```ts
const res = await server.fetch("/orders/999");
expect(res.status).toBe(404);
expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });

const bad = await server.fetch("/orders", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ total: -1 }),
});
expect(bad.status).toBe(422);
expect(await bad.json()).toMatchObject({ code: "VALIDATION", details: { in: "body" } });
```

## Testing middleware and narrowing

Type-level narrowing (`Middleware<{ user: User }>`) has nothing to assert at runtime — if it compiles, the type is correct. Test the runtime behavior instead: that a route without the middleware rejects, and a route with it exposes the right value.

## What this doesn't cover

There's no supported way to call a handler directly with a hand-built `ctx` — `ctx` is created from a real Express `req`/`res` pair, and constructing one outside a request isn't part of the public API. Test through the HTTP surface, as above; it's also what actually runs in production, so testing it directly exercises validation, middleware ordering, and error rendering as a whole rather than assuming they compose correctly.
