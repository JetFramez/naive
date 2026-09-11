import type { ErrorRequestHandler, RequestHandler } from "express";
import type { RequestContext } from "../ctx/create.js";
import { Internal } from "../errors/http-error.js";
import type { AnyMiddleware } from "../middleware/types.js";
import { RESPONSE, type ResponseDescriptor } from "../response/types.js";

/** Thrown internally when Express middleware calls `next("route")` or `next("router")`. */
export class RouteSkip {
  constructor(readonly target: "route" | "router") {}
}

export type Step = (ctx: RequestContext, next: () => Promise<void>) => unknown;

export function isDescriptor(value: unknown): value is ResponseDescriptor {
  return typeof value === "object" && value !== null && RESPONSE in value;
}

export function responded(ctx: RequestContext): boolean {
  return ctx.res.headersSent || ctx.res.writableEnded;
}

/** Waits for the response to finish or the connection to close. */
function onResponseDone(ctx: RequestContext, cb: () => void): () => void {
  const res = ctx.res;
  if (res.writableEnded) {
    cb();
    return () => {};
  }
  const done = () => {
    res.off("finish", done);
    res.off("close", done);
    cb();
  };
  res.once("finish", done);
  res.once("close", done);
  return () => {
    res.off("finish", done);
    res.off("close", done);
  };
}

/** Wraps an Express `(req, res, next)` handler so it participates in the chain untouched. */
function expressStep(handler: RequestHandler): Step {
  return (ctx, next) =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = onResponseDone(ctx, () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      const done = (err?: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err === "route" || err === "router") reject(new RouteSkip(err));
        else if (err) reject(err);
        else resolve(next());
      };
      try {
        const out: unknown = handler(ctx.req, ctx.res, done);
        if (out instanceof Promise) out.catch(done);
      } catch (err) {
        done(err);
      }
    });
}

/** Wraps an Express `(err, req, res, next)` handler: it sees errors thrown downstream. */
function expressErrorStep(handler: ErrorRequestHandler): Step {
  return async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      if (error instanceof RouteSkip) throw error;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = onResponseDone(ctx, () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        const done = (err?: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (err === "route" || err === "router") reject(new RouteSkip(err));
          else if (err) reject(err);
          else resolve();
        };
        try {
          const out: unknown = handler(error, ctx.req, ctx.res, done);
          if (out instanceof Promise) out.catch(done);
        } catch (err) {
          done(err);
        }
      });
    }
  };
}

export function toStep(middleware: AnyMiddleware): Step {
  if (middleware.length >= 4) return expressErrorStep(middleware as ErrorRequestHandler);
  if (middleware.length === 3) return expressStep(middleware as RequestHandler);
  return middleware as Step;
}

export interface ChainResult {
  /** `true` when a handler or middleware produced a value to send. */
  readonly produced: boolean;
  readonly value: unknown;
}

/**
 * Runs steps outer to inner. The last step is terminal: its return value is
 * the result. A middleware that returns a descriptor without calling `next()`
 * also produces the result. A middleware that neither responds, throws, calls
 * `next()`, nor returns a descriptor is a bug and raises `Internal`.
 */
export async function runChain(steps: readonly Step[], ctx: RequestContext): Promise<ChainResult> {
  let produced = false;
  let value: unknown;

  const dispatch = async (index: number): Promise<void> => {
    const step = steps[index];
    if (!step) return;
    const last = index === steps.length - 1;
    let called = false;
    const next = () => {
      if (called) return Promise.reject(new Internal("next() called more than once"));
      called = true;
      return dispatch(index + 1);
    };
    const out = await step(ctx, next);
    if (last) {
      produced = true;
      value = out;
    } else if (!called) {
      if (isDescriptor(out)) {
        produced = true;
        value = out;
      } else if (!responded(ctx)) {
        throw new Internal("middleware ended without responding or calling next()");
      }
    }
  };

  await dispatch(0);
  return { produced, value };
}
