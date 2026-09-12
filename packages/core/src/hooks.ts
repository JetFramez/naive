import type { Express, RequestHandler } from "express";
import { runInCtx } from "./als.js";
import { type CtxOptions, ensureCtx, type RequestContext } from "./ctx/create.js";
import type { Ctx } from "./ctx/types.js";
import type { ErrorHook, RequestHook, ResponseHook } from "./router/types.js";

/** App-level hooks accumulated on the request context. */
export interface AppHooks {
  readonly onRequest: RequestHook[];
  readonly onResponse: ResponseHook[];
  readonly onError: ErrorHook[];
}

export function createAppHooks(): AppHooks {
  return { onRequest: [], onResponse: [], onError: [] };
}

export interface RequestLogOptions {
  /** Return `true` to skip the request line (health checks, for example). */
  ignore?: ((ctx: Ctx) => boolean) | undefined;
}

export interface ContextOptions extends CtxOptions {
  onRequest?: RequestHook | readonly RequestHook[] | undefined;
  onResponse?: ResponseHook | readonly ResponseHook[] | undefined;
  onError?: ErrorHook | readonly ErrorHook[] | undefined;
  /** One `info` line per request on finish. `false` disables. Default on. */
  requestLog?: boolean | RequestLogOptions | undefined;
}

function list<T>(value: T | readonly T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? [...value] : [value as T];
}

/** @internal Runs hooks in order; errors are logged and swallowed. */
export async function runHooksSafely<A extends unknown[]>(
  ctx: RequestContext,
  hooks: ReadonlyArray<(...args: A) => unknown>,
  args: A,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook(...args);
    } catch (error) {
      ctx.log.error({ err: error }, "hook threw");
    }
  }
}

function onDone(ctx: RequestContext, cb: () => void): void {
  const res = ctx.res;
  let fired = false;
  const once = () => {
    if (fired) return;
    fired = true;
    res.off("finish", once);
    res.off("close", once);
    cb();
  };
  res.once("finish", once);
  res.once("close", once);
}

/**
 * The context middleware: creates `ctx`, makes it ambient through
 * `AsyncLocalStorage`, registers app-level hooks, and writes the request log
 * line. `createApp` installs it first; on a bare Express app use it (or
 * `hooks()`) before routes. Safe to install more than once.
 */
export function context(options: ContextOptions = {}): RequestHandler {
  const onRequest = list(options.onRequest);
  const onResponse = list(options.onResponse);
  const onError = list(options.onError);
  const requestLog = options.requestLog ?? true;

  return (req, res, next) => {
    const ctx = ensureCtx(req, res, options);
    ctx.appHooks.onRequest.push(...onRequest);
    ctx.appHooks.onResponse.push(...onResponse);
    ctx.appHooks.onError.push(...onError);

    if (onResponse.length > 0) {
      onDone(ctx, () => {
        void runHooksSafely(ctx, onResponse, [ctx, ctx.result]);
      });
    }

    if (requestLog !== false && !ctx.requestLogArmed) {
      ctx.requestLogArmed = true;
      const ignore = typeof requestLog === "object" ? requestLog.ignore : undefined;
      onDone(ctx, () => {
        if (ignore?.(ctx)) return;
        const fields: Record<string, unknown> = {
          method: ctx.method,
          path: ctx.path,
          route: ctx.route,
          status: res.statusCode,
          duration: Date.now() - ctx.startedAt,
        };
        if (!res.writableFinished) fields.aborted = true;
        ctx.log.info(fields, "request");
      });
    }

    runInCtx(ctx, () => {
      if (onRequest.length === 0) {
        next();
        return;
      }
      void (async () => {
        try {
          for (const hook of onRequest) await hook(ctx);
          next();
        } catch (error) {
          next(error);
        }
      })();
    });
  };
}

export interface HooksOptions {
  onRequest?: RequestHook | readonly RequestHook[] | undefined;
  onResponse?: ResponseHook | readonly ResponseHook[] | undefined;
  onError?: ErrorHook | readonly ErrorHook[] | undefined;
}

/**
 * Registers app-level hooks on a bare Express app by installing the context
 * middleware at this point. Call it before routes. `createApp` exposes the
 * same hooks as `app.onRequest()`, `app.onResponse()` and `app.onError()`.
 */
export function hooks(app: Express, options: HooksOptions): void {
  app.use(context({ ...options, requestLog: false }));
}
