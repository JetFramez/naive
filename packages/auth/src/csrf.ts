import { Forbidden, type Middleware } from "@notio-internal/core";
import { randomToken } from "./tokens.js";

export interface CsrfOptions {
  /** Cookie carrying the token. Default `"csrf"`. Readable by client script, so forms can echo it back. */
  cookie?: string;
  /** Header the token must be resubmitted in. Default `"x-csrf-token"`. */
  header?: string;
  /** Methods that do not require the header to match. Default `GET, HEAD, OPTIONS`. */
  safeMethods?: readonly string[];
}

/**
 * Double-submit-cookie CSRF protection for cookie sessions. Issues a token
 * cookie on any request that lacks one, and requires state-changing requests
 * to echo it back in a header.
 */
export function csrf(options: CsrfOptions = {}): Middleware {
  const cookieName = options.cookie ?? "csrf";
  const headerName = options.header ?? "x-csrf-token";
  const safe = new Set(
    (options.safeMethods ?? ["GET", "HEAD", "OPTIONS"]).map((m) => m.toUpperCase()),
  );

  return async (ctx, next) => {
    let token = ctx.cookies.get(cookieName);
    if (!token) {
      token = randomToken(16);
      ctx.cookies.set(cookieName, token, { httpOnly: false, sameSite: "strict" });
    }
    if (!safe.has(ctx.method.toUpperCase())) {
      const provided = ctx.headers.get(headerName);
      if (!provided || provided !== token) throw new Forbidden("Invalid or missing CSRF token");
    }
    await next();
  };
}
