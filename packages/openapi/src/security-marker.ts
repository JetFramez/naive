/**
 * The same well-known symbol `@notio-internal/auth`'s `auth.require()` tags
 * its middleware with. Recreated here via `Symbol.for` (the global symbol
 * registry) rather than importing the auth package, so the OpenAPI module
 * has no dependency on it: a route secured by any middleware that happens to
 * carry this symbol is documented; anything else, including a hand-rolled
 * auth check, is invisible, exactly as if it were unmarked.
 */
const AUTH_REQUIREMENT: unique symbol = Symbol.for("notio.auth.requirement");

export interface AuthRequirement {
  readonly strategies: readonly string[];
}

export function getAuthRequirement(middleware: unknown): AuthRequirement | undefined {
  if (typeof middleware !== "function") return undefined;
  const marked = (middleware as { [AUTH_REQUIREMENT]?: AuthRequirement })[AUTH_REQUIREMENT];
  return marked && Array.isArray(marked.strategies) ? marked : undefined;
}
