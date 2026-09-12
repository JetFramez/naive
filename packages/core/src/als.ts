import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { BaseCtx, Ctx, CtxKind } from "./ctx/types.js";
import { Internal } from "./errors/http-error.js";
import { getRootLogger } from "./logger/root.js";
import type { Logger } from "./logger/types.js";

const storage = new AsyncLocalStorage<BaseCtx>();

/** The ambient HTTP context, or `undefined` outside a request. */
export function currentCtx(): Ctx | undefined {
  const ctx = storage.getStore();
  return ctx?.kind === "http" ? (ctx as Ctx) : undefined;
}

/** The ambient context of any kind (HTTP request, job, CLI), or `undefined`. */
export function currentBaseCtx(): BaseCtx | undefined {
  return storage.getStore();
}

/** The ambient HTTP context; throws when called outside a request. */
export function requireCtx(): Ctx {
  const ctx = currentCtx();
  if (!ctx) throw new Internal("requireCtx() called outside of a request");
  return ctx;
}

/** @internal Runs `fn` with `ctx` as the ambient context unless it already is. */
export function runInCtx<T>(ctx: BaseCtx, fn: () => T): T {
  return storage.getStore() === ctx ? fn() : storage.run(ctx, fn);
}

export interface RunWithCtxOptions {
  requestId?: string | undefined;
  kind?: CtxKind | undefined;
  state?: Record<string, unknown> | undefined;
  log?: Logger | undefined;
}

/**
 * Runs `fn` under a context for work that is not an HTTP request (jobs, CLI,
 * event listeners). `log` and `currentBaseCtx()` see it. Fields not supplied
 * get defaults: a fresh `requestId`, `kind: "job"`, an empty `state`, and a
 * root child logger carrying `requestId` and `kind`.
 */
export function runWithCtx<T>(partial: RunWithCtxOptions, fn: (ctx: BaseCtx) => T): T {
  const requestId = partial.requestId ?? randomUUID();
  const kind = partial.kind ?? "job";
  const base: BaseCtx = {
    requestId,
    kind,
    state: partial.state ?? {},
    log: partial.log ?? getRootLogger().child({ requestId, kind }),
    bind(fields) {
      this.log = this.log.child(fields);
    },
  };
  return storage.run(base, () => fn(base));
}
