import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { Request, Response } from "express";
import { getRootLogger } from "../logger/console.js";
import type { Logger } from "../logger/types.js";
import {
  type DownloadResponse,
  type EmptyResponse,
  type FileResponse,
  type JsonResponse,
  type RawResponse,
  RESPONSE,
  type RedirectResponse,
  type ResponseInit,
  type StreamResponse,
  type TextResponse,
} from "../response/types.js";
import type { StandardSchemaV1 } from "../schema/standard.js";
import { CookieJar } from "./cookies.js";
import type { Ctx, CtxHeaders } from "./types.js";

export interface CtxOptions {
  logger?: Logger | undefined;
  /** Secret(s) for signed cookies. */
  cookieSecret?: string | string[] | undefined;
}

class Headers implements CtxHeaders<Record<string, unknown>> {
  readonly #ctx: RequestContext;
  /** Set by validation when the route declares a headers schema. */
  validated: Record<string, unknown> | undefined;

  constructor(ctx: RequestContext) {
    this.#ctx = ctx;
  }

  get(name: string): string | undefined {
    const value = this.#ctx.req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value.join(", ") : value;
  }

  has(name: string): boolean {
    return this.#ctx.req.headers[name.toLowerCase()] !== undefined;
  }

  all(): Record<string, unknown> {
    return this.validated ?? this.#ctx.req.headers;
  }

  set(name: string, value: string | number | readonly string[]): Ctx {
    this.#ctx.res.setHeader(name, value as string | number | string[]);
    return this.#ctx;
  }

  append(name: string, value: string | readonly string[]): Ctx {
    this.#ctx.res.append(name, value as string | string[]);
    return this.#ctx;
  }
}

/**
 * The runtime behind {@link Ctx}. Fields the interface exposes as readonly are
 * mutable here so the router can install validated values.
 */
export class RequestContext implements Ctx {
  readonly kind = "http" as const;
  readonly req: Request;
  readonly res: Response;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly state: Record<string, unknown> = {};
  readonly headers: Headers;
  readonly cookies: CookieJar;

  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
  route: string | undefined = undefined;
  log: Logger;

  /** Status chosen with `ctx.status()`, applied to plain return values. */
  statusCode: number | undefined = undefined;
  /** Installed by the router when the route declared `.response(schema)`. */
  responseSchema: StandardSchemaV1 | undefined = undefined;

  #url: URL | undefined;

  constructor(req: Request, res: Response, options: CtxOptions = {}) {
    this.req = req;
    this.res = res;
    this.method = req.method;
    this.path = (req.originalUrl ?? req.url).split("?")[0] ?? "/";
    const incoming = req.headers["x-request-id"];
    this.requestId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    this.params = { ...req.params };
    this.query = normaliseQuery(req.query as Record<string, unknown>);
    this.body = req.body;
    this.headers = new Headers(this);
    this.cookies = new CookieJar(this, { secret: options.cookieSecret });
    this.log = (options.logger ?? getRootLogger()).child({ requestId: this.requestId });
  }

  get url(): URL {
    this.#url ??= new URL(
      this.req.originalUrl ?? this.req.url,
      `${this.req.protocol}://${this.req.get("host") ?? "localhost"}`,
    );
    return this.#url;
  }

  get ip(): string {
    return this.req.ip ?? "";
  }

  bearer(): string | undefined {
    const header = this.headers.get("authorization");
    if (!header) return undefined;
    const [scheme, token] = header.split(" ", 2);
    return scheme?.toLowerCase() === "bearer" && token ? token.trim() : undefined;
  }

  accepts(...types: string[]): string | false {
    return this.req.accepts(types) as string | false;
  }

  set(name: string, value: string | number | readonly string[]): this {
    this.headers.set(name, value);
    return this;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  bind(fields: Record<string, unknown>): void {
    this.log = this.log.child(fields);
  }

  json<T>(data: T, init: ResponseInit = {}): JsonResponse<T> {
    return { [RESPONSE]: "json", data, ...init };
  }

  text(body: string, init: ResponseInit = {}): TextResponse {
    return { [RESPONSE]: "text", body, ...init };
  }

  redirect(url: string, status = 302): RedirectResponse {
    return { [RESPONSE]: "redirect", url, status };
  }

  file(path: string, options: { type?: string } & ResponseInit = {}): FileResponse {
    return { [RESPONSE]: "file", path, ...options };
  }

  download(path: string, filename?: string): DownloadResponse {
    return filename === undefined
      ? { [RESPONSE]: "download", path }
      : { [RESPONSE]: "download", path, filename };
  }

  stream(readable: Readable, options: { type?: string } & ResponseInit = {}): StreamResponse {
    return { [RESPONSE]: "stream", readable, ...options };
  }

  empty(status = 204): EmptyResponse {
    return { [RESPONSE]: "empty", status };
  }

  raw(write: (res: Response) => void | Promise<void>): RawResponse {
    return { [RESPONSE]: "raw", write };
  }
}

function normaliseQuery(query: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!query) return out;
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.map(String);
    else if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

/** Creates the context for a request and stores it on `res.locals.ctx`. */
export function createCtx(req: Request, res: Response, options?: CtxOptions): RequestContext {
  const ctx = new RequestContext(req, res, options);
  res.locals.ctx = ctx;
  return ctx;
}

/** The context previously created for this response, if any. */
export function ctxOf(res: Response): RequestContext | undefined {
  const ctx: unknown = res.locals.ctx;
  return ctx instanceof RequestContext ? ctx : undefined;
}

/** Returns the existing context or creates one. */
export function ensureCtx(req: Request, res: Response, options?: CtxOptions): RequestContext {
  return ctxOf(res) ?? createCtx(req, res, options);
}
