import { resolve } from "node:path";
import express, { type RequestHandler } from "express";
import { ensureCtx, type RequestContext } from "../ctx/create.js";
import { RESPONSE } from "../response/types.js";
import { parseDuration } from "../util/duration.js";
import { isDescriptor, RouteSkip, runChain, type Step, toStep } from "./compose.js";
import { sendResult } from "./send.js";
import type {
  CompiledRedirect,
  CompiledRoute,
  CompiledStatic,
  Entry,
  RouterHooks,
} from "./types.js";
import { validateRequest, validateResponse } from "./validate.js";

export interface CompileOptions {
  readonly validateResponses: boolean;
}

/** Marks an error whose router-level `onError` hooks already ran. */
export const ROUTER_HANDLED: unique symbol = Symbol.for("notio.error.routerHandled");

export function markHandled(error: unknown): void {
  if (typeof error === "object" && error !== null) {
    Object.defineProperty(error, ROUTER_HANDLED, { value: true, enumerable: false });
  }
}

export function wasHandledByRouter(error: unknown): boolean {
  return typeof error === "object" && error !== null && ROUTER_HANDLED in error;
}

async function runHooks<A extends unknown[]>(
  ctx: RequestContext,
  hooks: ReadonlyArray<(...args: A) => unknown>,
  args: A,
  swallow: boolean,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook(...args);
    } catch (error) {
      if (!swallow) throw error;
      ctx.log.error({ err: error }, "hook threw");
    }
  }
}

function shouldValidateResponses(options: CompileOptions): boolean {
  return options.validateResponses && process.env.NODE_ENV !== "production";
}

function routeHandler(route: CompiledRoute, options: CompileOptions): RequestHandler {
  const { info, hooks } = route;
  const validation: Step = async (ctx, next) => {
    await validateRequest(ctx, info.schemas);
    await next();
  };
  const terminal: Step = (ctx) => info.handler(ctx as never);
  const steps: Step[] = [
    ...route.inherited.map(toStep),
    validation,
    ...info.routeMiddleware.map(toStep),
    terminal,
  ];
  const routeLabel = `${info.method} ${info.path}`;
  const checkResponse = shouldValidateResponses(options) ? info.response : undefined;

  return (req, res, next) => {
    const ctx = ensureCtx(req, res);
    ctx.route = routeLabel;
    ctx.responseSchema = info.response;
    void (async () => {
      let result: unknown;
      try {
        await runHooks(ctx, hooks.onRequest, [ctx], false);
        const chain = await runChain(steps, ctx);
        result = chain.value;
        if (checkResponse && chain.produced) {
          const candidate =
            isDescriptor(result) && result[RESPONSE] === "json" ? result.data : result;
          if (!isDescriptor(result) || result[RESPONSE] === "json") {
            await validateResponse(checkResponse, candidate);
          }
        }
        if (chain.produced) await sendResult(ctx, result);
        await runHooks(ctx, hooks.onResponse, [ctx, result], true);
      } catch (error) {
        if (error instanceof RouteSkip) {
          next(error.target);
          return;
        }
        markHandled(error);
        await runHooks(ctx, hooks.onError, [ctx, error], true);
        next(error);
      }
    })();
  };
}

function staticHandler(entry: CompiledStatic): RequestHandler {
  const { maxAge, spa, ...rest } = entry.options;
  const serve = express.static(entry.dir, {
    ...rest,
    ...(maxAge === undefined ? {} : { maxAge: parseDuration(maxAge, "static maxAge") }),
  });
  const fallback: Step = spa
    ? (ctx, next) => {
        if (ctx.req.method !== "GET" && ctx.req.method !== "HEAD") return next();
        if (!ctx.req.accepts("html")) return next();
        return new Promise<void>((resolveP, reject) => {
          ctx.res.sendFile(resolve(entry.dir, "index.html"), (err) =>
            err ? reject(err) : resolveP(),
          );
        });
      }
    : (_ctx, next) => next();
  const steps: Step[] = [...entry.middleware.map(toStep), toStep(serve), fallback];
  return passthrough(steps, entry.hooks);
}

function redirectHandler(entry: CompiledRedirect): RequestHandler {
  const terminal: Step = (ctx) => ctx.redirect(entry.to, entry.status);
  const steps: Step[] = [...entry.middleware.map(toStep), terminal];
  return passthrough(steps, entry.hooks, true);
}

/** A chain that falls through to Express `next()` when nothing responded. */
function passthrough(steps: Step[], hooks: RouterHooks, terminal = false): RequestHandler {
  return (req, res, next) => {
    const ctx = ensureCtx(req, res);
    void (async () => {
      try {
        await runHooks(ctx, hooks.onRequest, [ctx], false);
        const chain = await runChain(steps, ctx);
        if (chain.produced && (terminal || chain.value !== undefined)) {
          await sendResult(ctx, chain.value);
        }
        if (!res.headersSent && !res.writableEnded) {
          next();
          return;
        }
        await runHooks(ctx, hooks.onResponse, [ctx, chain.value], true);
      } catch (error) {
        if (error instanceof RouteSkip) {
          next(error.target);
          return;
        }
        markHandled(error);
        await runHooks(ctx, hooks.onError, [ctx, error], true);
        next(error);
      }
    })();
  };
}

/** Builds an `express.Router()` from the collected entries, in registration order. */
export function compile(entries: readonly Entry[], options: CompileOptions): express.Router {
  const router = express.Router();
  for (const entry of entries) {
    switch (entry.kind) {
      case "route": {
        const method = entry.route.info.method.toLowerCase() as Lowercase<
          CompiledRoute["info"]["method"]
        >;
        router[method](entry.route.info.path, routeHandler(entry.route, options));
        break;
      }
      case "static":
        router.use(entry.static.path, staticHandler(entry.static));
        break;
      case "redirect":
        router.get(entry.redirect.from, redirectHandler(entry.redirect));
        break;
    }
  }
  return router;
}
