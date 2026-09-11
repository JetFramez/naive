import type { Ctx } from "../ctx/types.js";
import type { MaybePromise } from "../types.js";
import type { Middleware } from "./types.js";

/**
 * One-line checks: continues when `predicate` is truthy, otherwise throws the
 * error produced by `error`.
 *
 * @example
 * router.use(guard((ctx) => ctx.user.role === "admin", () => new Forbidden()));
 */
export function guard(
  predicate: (ctx: Ctx) => MaybePromise<unknown>,
  error: (ctx: Ctx) => Error,
): Middleware {
  return async (ctx, next) => {
    if (!(await predicate(ctx))) throw error(ctx);
    await next();
  };
}
