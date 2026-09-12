import type { RequestHandler } from "express";
import { runInCtx } from "../als.js";
import { ensureCtx, type RequestContext } from "../ctx/create.js";
import { Internal } from "../errors/http-error.js";
import { isDescriptor } from "../router/compose.js";
import { sendResult } from "../router/send.js";
import type { AnyMiddleware, CtxMiddleware } from "./types.js";

function finished(ctx: RequestContext): Promise<void> {
  const res = ctx.res;
  if (res.writableEnded) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      res.off("finish", done);
      res.off("close", done);
      resolve();
    };
    res.once("finish", done);
    res.once("close", done);
  });
}

/**
 * Adapts a `(ctx, next)` middleware to a standalone Express handler for use
 * outside a router (app level). `await next()` resolves when the response has
 * finished, so code after it observes the outcome but can no longer change
 * headers. Express middleware passes through untouched.
 */
export function toExpress(middleware: AnyMiddleware): RequestHandler {
  if (middleware.length >= 3) return middleware as RequestHandler;
  const mw = middleware as CtxMiddleware<any, any>;
  return (req, res, next) => {
    const ctx = ensureCtx(req, res);
    let called = false;
    const proceed = () => {
      if (called) return Promise.reject(new Internal("next() called more than once"));
      called = true;
      next();
      return finished(ctx);
    };
    runInCtx(ctx, () => {
      void (async () => {
        try {
          const out = await mw(ctx, proceed);
          if (called) return;
          if (isDescriptor(out)) {
            await sendResult(ctx, out);
          } else if (!res.headersSent && !res.writableEnded) {
            throw new Internal("middleware ended without responding or calling next()");
          }
        } catch (error) {
          if (!called) next(error);
          else ctx.log.error({ err: error }, "middleware threw after next()");
        }
      })();
    });
  };
}
