---
title: Config
---

`defineConfig` resolves configuration once at boot, validates every value, reports all problems together, and returns a frozen, typed object.

```ts
import { defineConfig, env } from "notio";
import { z } from "zod";

export const config = defineConfig({
  port: env.port({ default: 3000 }),
  database: {
    url: env.url(),
    poolSize: env.integer({ default: 5 }),
  },
  auth: {
    secret: env.string(),
    sessionTtl: env.duration({ default: "30d" }),
  },
  cors: { origins: env.list({ default: [] }) },
  features: z.object({ beta: z.boolean() }).default({ beta: false }),   // any Standard Schema works as a leaf
});

config.database.poolSize;   // number
config.auth.sessionTtl;     // number (milliseconds)
```

The shape is plain nested objects whose leaves are Standard Schema values. The `env` helpers are leaves that coerce from the strings environment variables provide, but Zod, Valibot or ArkType schemas work equally well (use coercion, since everything arrives as a string).

## Where values come from

Each leaf maps to one environment variable by convention: the path in SCREAMING_SNAKE case. `database.url` is `DATABASE_URL`; `upload.maxFileSize` is `UPLOAD_MAX_FILE_SIZE`.

Sources, highest precedence first:

1. `overrides` passed to `defineConfig` (for tests).
2. `process.env`.
3. `.env.<env>.local`
4. `.env.local`
5. `.env.<env>`
6. `.env`
7. The leaf's default.

`<env>` is `NODE_ENV`, or `development`. Files are read from the current directory and only outside production; production reads the real environment. A variable set to an empty string counts as unset.

## Leaves

| Leaf | Accepts | Produces |
|---|---|---|
| `env.string()` | string | string |
| `env.number()`, `env.integer()`, `env.port()` | `"42"` or `42` | number |
| `env.boolean()` | `true/false`, `1/0`, `yes/no`, `on/off` | boolean |
| `env.duration()` | `"30s"`, `"5m"`, `"30d"` or milliseconds | milliseconds |
| `env.bytes()` | `"10mb"`, `"1.5gb"` or bytes | bytes |
| `env.url()` | an absolute URL | string |
| `env.enum(["a", "b"])` | one of the values | the literal union |
| `env.list()` | `"a, b, c"` or an array | `string[]` |

Every leaf takes `{ default, optional }`. A leaf without either is required.

## Errors at boot

Every problem is collected and thrown at once as a `ConfigError`, naming the path and the variable:

```
ConfigError: Invalid configuration:
  - port (PORT): expected a port (0-65535), got "abc"
  - database.url (DATABASE_URL): expected a URL, got "nope"
  - auth.secret (AUTH_SECRET): required
```

## Printing safely

`config.$print()` returns a copy with values under any key matching `/secret|password|token|key/i` replaced by `[Redacted]`, for a startup log line. It is a non-enumerable property, so spreading or serialising the config does not include it.

## Module fragments

Modules ship their option schema as a fragment: a shape you can drop into `defineConfig` or ignore. Their factories accept a plain partial object and apply the fragment themselves, so all of these are valid:

```ts
uploads();
uploads({ maxFileSize: "50mb" });
uploads(config.upload);                          // config = defineConfig({ upload: uploadConfig, ... })
uploads({ ...config.upload, messages });
```

Write your own with `resolveConfig`:

```ts
export const cacheConfig = { ttl: env.duration({ default: "5m" }), prefix: env.string({ default: "app" }) };

export function createThing(options?: InferConfigInput<typeof cacheConfig>) {
  const resolved = resolveConfig(cacheConfig, options, "createThing()");   // defaults applied, errors listed
}
```
