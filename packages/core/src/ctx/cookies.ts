import { createHmac, timingSafeEqual } from "node:crypto";
import { parseCookie, stringifySetCookie } from "cookie";
import { Internal } from "../errors/http-error.js";
import { parseDuration } from "../util/duration.js";
import type { CookieOptions, Ctx, CtxCookies } from "./types.js";

export interface CookieJarOptions {
  /** HMAC keys for signed cookies. The first signs; all verify (rotation). */
  secret?: string | string[] | undefined;
}

function sign(value: string, key: string): string {
  return createHmac("sha256", key).update(value).digest("base64url");
}

export class CookieJar implements CtxCookies {
  readonly #ctx: Ctx;
  readonly #keys: string[];
  #parsed: Record<string, string> | undefined;

  constructor(ctx: Ctx, options: CookieJarOptions = {}) {
    this.#ctx = ctx;
    const secret = options.secret;
    this.#keys = secret === undefined ? [] : Array.isArray(secret) ? secret : [secret];
  }

  get(name: string): string | undefined {
    return this.all()[name];
  }

  all(): Record<string, string> {
    if (!this.#parsed) {
      const parsed = parseCookie(this.#ctx.req.headers.cookie ?? "");
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) if (v !== undefined) out[k] = v;
      this.#parsed = out;
    }
    return this.#parsed;
  }

  set(name: string, value: string, options: CookieOptions = {}): Ctx {
    const { maxAge, ...rest } = options;
    this.#ctx.res.append(
      "Set-Cookie",
      stringifySetCookie({
        name,
        value,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: this.#ctx.req.secure,
        ...rest,
        ...(maxAge === undefined
          ? {}
          : { maxAge: Math.floor(parseDuration(maxAge, `cookie "${name}" maxAge`) / 1000) }),
      }),
    );
    return this.#ctx;
  }

  delete(name: string, options: Pick<CookieOptions, "path" | "domain"> = {}): Ctx {
    return this.set(name, "", { ...options, expires: new Date(0), maxAge: 0 });
  }

  getSigned(name: string): string | undefined {
    this.#requireSecret("getSigned");
    const raw = this.get(name);
    if (raw === undefined) return undefined;
    const dot = raw.lastIndexOf(".");
    if (dot <= 0) return undefined;
    const value = raw.slice(0, dot);
    const sig = Buffer.from(raw.slice(dot + 1));
    for (const key of this.#keys) {
      const expected = Buffer.from(sign(value, key));
      if (expected.length === sig.length && timingSafeEqual(expected, sig)) return value;
    }
    return undefined;
  }

  setSigned(name: string, value: string, options?: CookieOptions): Ctx {
    const key = this.#requireSecret("setSigned");
    return this.set(name, `${value}.${sign(value, key)}`, options);
  }

  #requireSecret(method: string): string {
    const key = this.#keys[0];
    if (key === undefined) {
      throw new Internal(
        `ctx.cookies.${method}() needs a cookie secret: pass createApp({ cookies: { secret } })`,
      );
    }
    return key;
  }
}
