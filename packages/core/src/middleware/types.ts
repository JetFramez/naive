import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Ctx } from "../ctx/types.js";
import type { ResponseDescriptor } from "../response/types.js";
import type { MaybePromise, UnionToIntersection } from "../types.js";

/** Continues to the next middleware or the handler. */
export type Next = () => Promise<void>;

/**
 * A middleware either calls `next()`, responds through `ctx.res`, throws, or
 * returns a response descriptor without calling `next()`.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: void is the common case; a descriptor is the short-circuit
export type MiddlewareResult = MaybePromise<void | ResponseDescriptor>;

declare const ADDS: unique symbol;

/**
 * A notio middleware bound to a specific context type. Prefer {@link Middleware}
 * in user code; this form exists so builders can offer a narrowed `ctx`.
 */
export type CtxMiddleware<C = Ctx, Adds extends object = {}> = ((
  ctx: C & Partial<Adds>,
  next: Next,
) => MiddlewareResult) & { readonly [ADDS]?: Adds };

/**
 * A `(ctx, next)` middleware. `Adds` declares what it puts on `ctx`; every
 * middleware and handler after it in the chain sees those fields as present.
 *
 * @example
 * const authed: Middleware<{ user: User }> = async (ctx, next) => {
 *   ctx.user = await lookup(ctx.bearer());
 *   await next();
 * };
 */
export type Middleware<Adds extends object = {}> = CtxMiddleware<Ctx, Adds>;

/** Any Express `(req, res, next)` or `(err, req, res, next)` handler. Runs untouched. */
export type ExpressMiddleware = RequestHandler | ErrorRequestHandler;

export type AnyMiddleware = CtxMiddleware<any, any> | ExpressMiddleware;

/** The `Adds` of a single middleware; `{}` for Express middleware and untyped functions. */
export type AddsOf<M> = M extends { readonly [ADDS]?: infer A }
  ? [NonNullable<A>] extends [never]
    ? {}
    : unknown extends NonNullable<A>
      ? {}
      : NonNullable<A> extends object
        ? NonNullable<A>
        : {}
  : {};

/** Intersection of the `Adds` of every middleware in a tuple. */
export type AddsOfAll<M extends readonly unknown[]> =
  UnionToIntersection<{ [K in keyof M]: AddsOf<M[K]> }[number]> extends infer I
    ? unknown extends I
      ? {}
      : I
    : {};

/** Shape a `(ctx, next)` function must have to be used where the context is `C`. */
export type CtxMiddlewareFor<C> = (ctx: C, next: Next) => MiddlewareResult;
