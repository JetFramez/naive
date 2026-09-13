---
title: What notio does not do
---

A short, explicit list, so you don't go looking for something that isn't here on purpose.

## Not in the auth module

`@jetframez/notio/auth` covers strategies, sessions, JWTs, opaque tokens with rotation, and password hashing — nothing else. Specifically absent:

- **OAuth** and social login.
- **Magic links.**
- **Two-factor authentication.**
- **Email verification.**
- **Password reset flows.**
- **An authorization model.** notio has no concept of roles or permissions. Build access control on top of `currentUser()` / `requireUser()` and your own logic — `guard()` in [Middleware](/guide/core/middleware#ctx-middleware-and-narrowing) is the usual shape for it.

## Not anywhere in the framework

- **Background jobs.** No chainable job definitions, no dispatch, no chains or batches, no queue integration.
- **A scheduler.** Nothing runs on a cron-like interval as part of the framework.
- **A generated TypeScript client.** The OpenAPI module produces a spec; turning that into a typed client for a frontend is a separate tool, out of scope here.
- **Testing helpers as a distinct package.** There's no `testClient` or `testCtx`. Testing works through ordinary tools — supertest against `app.express`, config overrides, a logger destination — see [Testing](/guide/guides/testing).
- **An events outbox or queue.** The event bus in [Events](/guide/core/events) is in-process and not persisted; an event is lost if the process dies before its listeners run. Use `emitAndWait` when a side effect must complete before the response, and reach for a real queue if you need delivery guarantees across a crash.
- **Code generation of any kind**, beyond the OpenAPI document itself.

## Why list this at all

Some of these are absent because they'd cut against a [design principle](/guide/about/principles) — an authorization model would mean deciding your domain's shape for you, which contradicts "nothing implicit at boot." Others are simply not built yet. Either way, the fastest way to find out whether something exists is to check the [exports reference](/reference/exports) or search this site — nothing here is hidden behind a flag or an internal API.
