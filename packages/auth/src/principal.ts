import { type Ctx, currentCtx, Unauthorized } from "@naive-internal/core";

/** The authenticated user for the current request, via ALS. `undefined` outside a request or if unauthenticated. */
export function currentUser<User = unknown>(): User | undefined {
  const ctx = currentCtx() as (Ctx & { user?: User }) | undefined;
  return ctx?.user;
}

/** Like {@link currentUser}, but throws `Unauthorized` when there is none. */
export function requireUser<User = unknown>(): User {
  const user = currentUser<User>();
  if (user === undefined) throw new Unauthorized("Authentication required");
  return user;
}
