import type { Readable } from "node:stream";
import type { Request, Response } from "express";
import type { Logger } from "../logger/types.js";
import type {
  DownloadResponse,
  EmptyResponse,
  FileResponse,
  JsonResponse,
  RawResponse,
  RedirectResponse,
  ResponseInit,
  StreamResponse,
  TextResponse,
} from "../response/types.js";

export type CtxKind = "http" | "job" | "cli" | (string & {});

/**
 * The subset of the context that exists outside HTTP (jobs, CLI). Augment it
 * with `declare module "@jetframez/naive" { interface BaseCtx { ... } }`.
 */
export interface BaseCtx {
  readonly requestId: string;
  readonly kind: CtxKind;
  readonly state: Record<string, unknown>;
  log: Logger;
  /** Adds fields to every subsequent `ctx.log` line. */
  bind(fields: Record<string, unknown>): void;
}

/** Query shape when a route declares no query schema. Values are raw strings. */
export type DefaultQuery = Record<string, string | string[]>;

/** Header shape when a route declares no headers schema. */
export type DefaultHeaders = Record<string, string | string[] | undefined>;

export interface CtxHeaders<H = DefaultHeaders> {
  /** Request header, case-insensitive. Multi-value headers are joined with `, `. */
  get(name: string): string | undefined;
  has(name: string): boolean;
  /** Request headers as validated by the route's headers schema, or raw when none. */
  all(): H;
  /** Sets a response header. */
  set(name: string, value: string | number | readonly string[]): Ctx;
  /** Appends to a response header. */
  append(name: string, value: string | readonly string[]): Ctx;
}

export interface CookieOptions {
  /** Milliseconds or a duration string such as `"30d"`. */
  maxAge?: number | string;
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  partitioned?: boolean;
  priority?: "low" | "medium" | "high";
}

export interface CtxCookies {
  get(name: string): string | undefined;
  all(): Record<string, string>;
  set(name: string, value: string, options?: CookieOptions): Ctx;
  delete(name: string, options?: Pick<CookieOptions, "path" | "domain">): Ctx;
  /** Reads a cookie signed with the configured secret; `undefined` when missing or tampered. */
  getSigned(name: string): string | undefined;
  setSigned(name: string, value: string, options?: CookieOptions): Ctx;
}

/**
 * The per-request context. This is the loose, augmentable shape every
 * middleware and helper can accept; routes see {@link TypedCtx} with params,
 * query, body and headers narrowed by the path and schemas.
 *
 * Augment globally with `declare module "@jetframez/naive" { interface Ctx { user?: User } }`.
 */
export interface Ctx extends BaseCtx {
  readonly kind: "http";
  /** The real Express request. */
  readonly req: Request;
  /** The real Express response. */
  readonly res: Response;

  readonly params: Record<string, unknown>;
  readonly query: Record<string, unknown>;
  readonly body: unknown;
  readonly headers: CtxHeaders<Record<string, unknown>>;

  readonly method: string;
  readonly path: string;
  /** The matched route pattern, e.g. `"POST /orders/:id"`. */
  readonly route: string | undefined;
  readonly url: URL;
  /** Client IP; respects Express `trust proxy`. */
  readonly ip: string;

  bearer(): string | undefined;
  accepts(...types: string[]): string | false;

  /** Shortcut for `ctx.headers.set()`. */
  set(name: string, value: string | number | readonly string[]): this;
  /** Status code applied to a plain return value. Descriptors override it. */
  status(code: number): this;

  readonly cookies: CtxCookies;

  json<T>(data: T, init?: ResponseInit): JsonResponse<T>;
  text(body: string, init?: ResponseInit): TextResponse;
  redirect(url: string, status?: number): RedirectResponse;
  file(path: string, options?: { type?: string } & ResponseInit): FileResponse;
  download(path: string, filename?: string): DownloadResponse;
  stream(readable: Readable, options?: { type?: string } & ResponseInit): StreamResponse;
  empty(status?: number): EmptyResponse;
  raw(write: (res: Response) => void | Promise<void>): RawResponse;
}

/**
 * A {@link Ctx} whose `params`, `body`, `query` and `headers` carry the types
 * inferred from the route path and schemas. Assignable to `Ctx`.
 */
export type TypedCtx<
  P = Record<string, string>,
  B = unknown,
  Q = DefaultQuery,
  H = DefaultHeaders,
> = Omit<Ctx, "params" | "body" | "query" | "headers"> & {
  readonly params: P;
  readonly body: B;
  readonly query: Q;
  readonly headers: CtxHeaders<H>;
};
