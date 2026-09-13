import { Server } from "node:http";
import express, { ErrorRequestHandler, Express, NextFunction, Request, RequestHandler, Response } from "express";
import { Readable } from "node:stream";
import { DestinationStream, Logger } from "pino";
import { Keyv, KeyvStoreAdapter } from "keyv";
//#region ../core/dist/index.d.ts
//#region src/logger/types.d.ts
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
interface LogFn {
  (message: string, ...args: unknown[]): void;
  (fields: object, message?: string, ...args: unknown[]): void;
}
/** The logging surface notio exposes. pino sits underneath. */
interface Logger$1 {
  level: LogLevel;
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  child(fields: Record<string, unknown>): Logger$1;
  isLevelEnabled(level: LogLevel): boolean;
}
//#endregion
//#region src/response/types.d.ts
/** Brand carried by every response descriptor returned from `ctx.json()` and friends. */
declare const RESPONSE: unique symbol;
type ResponseHeaders = Record<string, string | number | readonly string[]>;
interface ResponseInit {
  status?: number;
  headers?: ResponseHeaders;
}
interface JsonResponse<T = unknown> extends ResponseInit {
  readonly [RESPONSE]: "json";
  readonly data: T;
}
interface TextResponse extends ResponseInit {
  readonly [RESPONSE]: "text";
  readonly body: string;
}
interface RedirectResponse {
  readonly [RESPONSE]: "redirect";
  readonly url: string;
  readonly status: number;
}
interface FileResponse extends ResponseInit {
  readonly [RESPONSE]: "file";
  readonly path: string;
  readonly type?: string;
}
interface DownloadResponse extends ResponseInit {
  readonly [RESPONSE]: "download";
  readonly path: string;
  readonly filename?: string;
}
interface StreamResponse extends ResponseInit {
  readonly [RESPONSE]: "stream";
  readonly readable: Readable;
  readonly type?: string;
}
interface EmptyResponse {
  readonly [RESPONSE]: "empty";
  readonly status: number;
}
interface RawResponse {
  readonly [RESPONSE]: "raw";
  readonly write: (res: Response) => void | Promise<void>;
}
/** Anything a handler can return to describe the response explicitly. */
type ResponseDescriptor = JsonResponse | TextResponse | RedirectResponse | FileResponse | DownloadResponse | StreamResponse | EmptyResponse | RawResponse;
//#endregion
//#region src/ctx/types.d.ts
type CtxKind = "http" | "job" | "cli" | (string & {});
/**
 * The subset of the context that exists outside HTTP (jobs, CLI). Augment it
 * with `declare module "@jetframez/notio" { interface BaseCtx { ... } }`.
 */
interface BaseCtx {
  readonly requestId: string;
  readonly kind: CtxKind;
  readonly state: Record<string, unknown>;
  log: Logger$1;
  /** Adds fields to every subsequent `ctx.log` line. */
  bind(fields: Record<string, unknown>): void;
}
/** Query shape when a route declares no query schema. Values are raw strings. */
type DefaultQuery = Record<string, string | string[]>;
/** Header shape when a route declares no headers schema. */
type DefaultHeaders = Record<string, string | string[] | undefined>;
interface CtxHeaders<H = DefaultHeaders> {
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
interface CookieOptions {
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
interface CtxCookies {
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
 * Augment globally with `declare module "@jetframez/notio" { interface Ctx { user?: User } }`.
 */
interface Ctx extends BaseCtx {
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
  file(path: string, options?: {
    type?: string;
  } & ResponseInit): FileResponse;
  download(path: string, filename?: string): DownloadResponse;
  stream(readable: Readable, options?: {
    type?: string;
  } & ResponseInit): StreamResponse;
  empty(status?: number): EmptyResponse;
  raw(write: (res: Response) => void | Promise<void>): RawResponse;
}
/**
 * A {@link Ctx} whose `params`, `body`, `query` and `headers` carry the types
 * inferred from the route path and schemas. Assignable to `Ctx`.
 */
type TypedCtx<P = Record<string, string>, B = unknown, Q = DefaultQuery, H = DefaultHeaders> = Omit<Ctx, "params" | "body" | "query" | "headers"> & {
  readonly params: P;
  readonly body: B;
  readonly query: Q;
  readonly headers: CtxHeaders<H>;
};
//#endregion
//#region src/als.d.ts
/** The ambient HTTP context, or `undefined` outside a request. */
declare function currentCtx(): Ctx | undefined;
/** The ambient context of any kind (HTTP request, job, CLI), or `undefined`. */
declare function currentBaseCtx(): BaseCtx | undefined;
/** The ambient HTTP context; throws when called outside a request. */
declare function requireCtx(): Ctx;
interface RunWithCtxOptions {
  requestId?: string | undefined;
  kind?: CtxKind | undefined;
  state?: Record<string, unknown> | undefined;
  log?: Logger$1 | undefined;
}
/**
 * Runs `fn` under a context for work that is not an HTTP request (jobs, CLI,
 * event listeners). `log` and `currentBaseCtx()` see it. Fields not supplied
 * get defaults: a fresh `requestId`, `kind: "job"`, an empty `state`, and a
 * root child logger carrying `requestId` and `kind`.
 */
declare function runWithCtx<T>(partial: RunWithCtxOptions, fn: (ctx: BaseCtx) => T): T;
//#endregion
//#region src/errors/http-error.d.ts
/**
 * Base class for every error notio sends to a client. The wire shape is always
 * `{ code, message, details?, requestId }`.
 */
declare class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message?: string, details?: unknown);
}
/** A subclass factory: `class TeapotError extends defineError(418, "TEAPOT") {}`. */
declare function defineError(status: number, code: string): {
  new (message?: string, details?: unknown): {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
  stackTraceLimit: number;
};
declare const BadRequest_base: {
  new (message?: string, details?: unknown): {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
  stackTraceLimit: number;
};
declare class BadRequest extends BadRequest_base {}
declare const Unauthorized_base: {
  new (message?: string, details?: unknown): {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
  stackTraceLimit: number;
};
declare class Unauthorized extends Unauthorized_base {}
declare const Forbidden_base: {
  new (message?: string, details?: unknown): {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
  stackTraceLimit: number;
};
declare class Forbidden extends Forbidden_base {}
declare const NotFound_base: {
  new (message?: string, details?: unknown): {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
  stackTraceLimit: number;
};
declare class NotFound extends NotFound_base {}
declare const MethodNotAllowed_base: {
  new (message?: string, details?: unknown): {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
  stackTraceLimit: number;
};
declare class MethodNotAllowed extends MethodNotAllowed_base {}
declare const Conflict_base: {
  new (message?: string, details?: unknown): {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
  stackTraceLimit: number;
};
declare class Conflict extends Conflict_base {}
declare const Gone_base: {
  new (message?: string, details?: unknown): {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
  stackTraceLimit: number;
};
declare class Gone extends Gone_base {}
declare const PayloadTooLarge_base: {
  new (message?: string, details?: unknown): {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
  stackTraceLimit: number;
};
declare class PayloadTooLarge extends PayloadTooLarge_base {}
declare const Unprocessable_base: {
  new (message?: string, details?: unknown): {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
  stackTraceLimit: number;
};
declare class Unprocessable extends Unprocessable_base {}
declare const TooManyRequests_base: {
  new (message?: string, details?: unknown): {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
  stackTraceLimit: number;
};
declare class TooManyRequests extends TooManyRequests_base {}
declare const Internal_base: {
  new (message?: string, details?: unknown): {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
  stackTraceLimit: number;
};
declare class Internal extends Internal_base {}
declare const ServiceUnavailable_base: {
  new (message?: string, details?: unknown): {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
  stackTraceLimit: number;
};
declare class ServiceUnavailable extends ServiceUnavailable_base {}
declare function isHttpError(value: unknown): value is HttpError;
//#endregion
//#region src/errors/handler.d.ts
/** What the classifier produces for any thrown value. */
interface MappedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}
interface ErrorHandlerOptions {
  /**
   * First look at every error. Return a {@link MappedError} or an `HttpError`
   * to decide the response; return `undefined` to fall through to the
   * built-in classification.
   */
  map?: ((error: unknown, ctx: Ctx) => MappedError | HttpError | undefined) | undefined;
  /** Replaces the default `{ code, message, details?, requestId }` envelope. */
  format?: ((mapped: MappedError, ctx: Ctx) => unknown) | undefined;
  /**
   * Include the real message (and stack) of unclassified errors in 500
   * responses. Defaults to `true` outside production.
   */
  expose?: boolean | undefined;
  logger?: Logger$1 | undefined;
}
/**
 * Turns anything thrown into a status, code, message and details.
 *
 * 1. `HttpError` → as declared.
 * 2. An error carrying Standard Schema / Zod `issues` → 422 `VALIDATION`.
 * 3. body-parser errors → 400 malformed body, 413 over the limit.
 * 4. Any error with a numeric `status`/`statusCode` (http-errors convention) →
 *    that status; the message is used only when `err.expose` is true.
 * 5. Everything else → 500 `INTERNAL`; `expose` decides whether the real
 *    message is shown.
 *
 * The error's name is never part of the result.
 */
declare function classifyError(error: unknown, expose: boolean): MappedError;
/** The default wire shape. `stack` is present only for exposed 5xx errors. */
declare function defaultEnvelope(mapped: MappedError, ctx: Ctx, stack?: string): unknown;
/**
 * Express error handler that renders every error in the unified shape. Register
 * it last on a bare Express app; `createApp` installs it for you and
 * `app.errors()` configures it.
 */
declare function errorHandler(options?: ErrorHandlerOptions): ErrorRequestHandler;
/**
 * Terminal handler that turns an unmatched request into `NotFound`, so the
 * error handler renders it. `createApp` installs it after everything else.
 */
declare function notFound(): RequestHandler;
//#endregion
//#region src/logger/pino.d.ts
declare const LOG_LEVELS: readonly LogLevel[];
/** Keys redacted by default wherever they appear at the top level or one level down. */
declare const DEFAULT_REDACT: readonly string[];
interface LoggerOptionsInput {
  /** Defaults to `LOG_LEVEL`, then `"info"`. */
  level?: LogLevel | undefined;
  /** Human-readable output via pino-pretty. Defaults to on outside production when stdout is a TTY. */
  pretty?: boolean | undefined;
  /** Redaction paths; replaces the defaults. */
  redact?: readonly string[] | undefined;
  /** Static fields on every line. */
  base?: Record<string, unknown> | undefined;
  name?: string | undefined;
  /** Where to write. Mostly for tests. Ignored when `pretty` is set. */
  destination?: DestinationStream | undefined;
}
/** Adapts a pino instance to the {@link Logger} interface. `raw` is the pino logger itself. */
declare class PinoLogger implements Logger$1 {
  readonly raw: Logger;
  readonly trace: LogFn;
  readonly debug: LogFn;
  readonly info: LogFn;
  readonly warn: LogFn;
  readonly error: LogFn;
  readonly fatal: LogFn;
  constructor(raw: Logger);
  get level(): LogLevel;
  set level(level: LogLevel);
  child(fields: Record<string, unknown>): Logger$1;
  isLevelEnabled(level: LogLevel): boolean;
}
/** Creates a standalone logger. Most code should use `createApp({ logger })` or `configureLogger()`. */
declare function createLogger(options?: LoggerOptionsInput): Logger$1;
/**
 * Builds the root logger for scripts and tests that do not go through
 * `createApp`. Returns the new root.
 */
declare function configureLogger(options?: LoggerOptionsInput): Logger$1;
//#endregion
//#region src/types.d.ts
/** Flattens intersections into a single object type for readable hovers. */
type Simplify<T> = { [K in keyof T]: T[K]; } & {};
/** Turns a union into an intersection: `A | B` → `A & B`. */
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends ((x: infer I) => void) ? I : never;
type MaybePromise<T> = T | Promise<T>;
//#endregion
//#region src/middleware/types.d.ts
/** Continues to the next middleware or the handler. */
type Next = () => Promise<void>;
/**
 * A middleware either calls `next()`, responds through `ctx.res`, throws, or
 * returns a response descriptor without calling `next()`.
 */
type MiddlewareResult = MaybePromise<void | ResponseDescriptor>;
declare const ADDS: unique symbol;
/**
 * A notio middleware bound to a specific context type. Prefer {@link Middleware}
 * in user code; this form exists so builders can offer a narrowed `ctx`.
 */
type CtxMiddleware<C = Ctx, Adds extends object = {}> = ((ctx: C & Partial<Adds>, next: Next) => MiddlewareResult) & {
  readonly [ADDS]?: Adds;
};
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
type Middleware<Adds extends object = {}> = CtxMiddleware<Ctx, Adds>;
/** Any Express `(req, res, next)` or `(err, req, res, next)` handler. Runs untouched. */
type ExpressMiddleware = RequestHandler | ErrorRequestHandler;
type AnyMiddleware = CtxMiddleware<any, any> | ExpressMiddleware;
/** The `Adds` of a single middleware; `{}` for Express middleware and untyped functions. */
type AddsOf<M> = M extends {
  readonly [ADDS]?: infer A;
} ? [NonNullable<A>] extends [never] ? {} : unknown extends NonNullable<A> ? {} : NonNullable<A> extends object ? NonNullable<A> : {} : {};
/** Intersection of the `Adds` of every middleware in a tuple. */
type AddsOfAll<M extends readonly unknown[]> = UnionToIntersection<{ [K in keyof M]: AddsOf<M[K]>; }[number]> extends (infer I) ? unknown extends I ? {} : I : {};
/** Shape a `(ctx, next)` function must have to be used where the context is `C`. */
type CtxMiddlewareFor<C> = (ctx: C, next: Next) => MiddlewareResult;
//#endregion
//#region src/router/paths.d.ts
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type Lower = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z";
type WordChar = Lower | Uppercase<Lower> | Digit | "_";
/** Reads a parameter name (word characters) off the front of `S`. */
type TakeName<S extends string, Acc extends string = ""> = S extends `${infer C}${infer R}` ? C extends WordChar ? TakeName<R, `${Acc}${C}`> : [Acc, S] : [Acc, ""];
/**
 * Walks an Express 5 path character by character, collecting `:name` and
 * `*name` parameters. Parameters inside `{...}` groups are optional.
 */
type Scan<S extends string, InOptional extends boolean, Required extends string, Optional extends string> = S extends `${infer C}${infer R}` ? C extends ":" | "*" ? TakeName<R> extends [infer Name extends string, infer Rest extends string] ? Name extends "" ? Scan<Rest, InOptional, Required, Optional> : InOptional extends true ? Scan<Rest, InOptional, Required, Optional | Name> : Scan<Rest, InOptional, Required | Name, Optional> : never : C extends "{" ? Scan<R, true, Required, Optional> : C extends "}" ? Scan<R, false, Required, Optional> : Scan<R, InOptional, Required, Optional> : {
  required: Required;
  optional: Optional;
};
/**
 * Parameters inferred from a path string.
 *
 * `"/orders/:id/lines/:lineId"` → `{ id: string; lineId: string }`
 * `"/files/*path"`              → `{ path: string }`
 * `"/users{/:id}"`              → `{ id?: string }`
 *
 * A non-literal `string` path yields `Record<string, string>`.
 */
type PathParams<Path extends string> = string extends Path ? Record<string, string> : Scan<Path, false, never, never> extends {
  required: infer R extends string;
  optional: infer O extends string;
} ? Simplify<{ [K in R]: string; } & { [K in O]?: string; }> : never;
/** Union of parameter names in a path. */
type ParamKeys<Path extends string> = keyof PathParams<Path> & string;
/** Runtime twin of {@link PathParams}: the parameter names in a path, in order. */
declare function paramNames(path: string): string[];
/** Joins a prefix and a path, collapsing duplicate slashes and trailing slashes. */
declare function joinPath(prefix: string, path: string): string;
//#endregion
//#region src/schema/standard.d.ts
/**
 * The Standard Schema V1 interface (https://standardschema.dev), copied here so
 * notio has no runtime or type dependency on any particular validation library.
 * Zod, Valibot, ArkType and others implement it.
 */
interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaProps<Input, Output>;
}
interface StandardSchemaProps<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
  readonly types?: StandardTypes<Input, Output> | undefined;
}
type StandardResult<Output> = StandardSuccess<Output> | StandardFailure;
interface StandardSuccess<Output> {
  readonly value: Output;
  readonly issues?: undefined;
}
interface StandardFailure {
  readonly issues: ReadonlyArray<StandardIssue>;
}
interface StandardIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | StandardPathSegment> | undefined;
}
interface StandardPathSegment {
  readonly key: PropertyKey;
}
interface StandardTypes<Input = unknown, Output = Input> {
  readonly input: Input;
  readonly output: Output;
}
/** The type a schema accepts. */
type InferInput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["input"];
/** The type a schema produces after validation and transforms. */
type InferOutput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["output"];
//#endregion
//#region src/router/uploads.d.ts
declare const UPLOAD_ISSUE_CODES: readonly ["FILE_TOO_LARGE", "FILE_TYPE_NOT_ALLOWED", "TOO_MANY_FILES", "FILE_REQUIRED", "UNEXPECTED_FILE", "TOTAL_SIZE_EXCEEDED"];
type UploadIssueCode = (typeof UPLOAD_ISSUE_CODES)[number];
interface UploadIssueMeta {
  code: UploadIssueCode;
  field: string;
  filename?: string;
  /** The configured limit the file violated (bytes or count). */
  limit?: number;
  /** The observed value (bytes or count). */
  actual?: number;
  /** Allowed MIME types for `FILE_TYPE_NOT_ALLOWED`. */
  allowed?: readonly string[];
  /** Detected MIME type for `FILE_TYPE_NOT_ALLOWED`. */
  detected?: string;
}
type UploadMessage = string | ((meta: UploadIssueMeta) => string);
type UploadMessages = Partial<Record<UploadIssueCode, UploadMessage>>;
/** Per-field upload rules declared with `.uploads({ field: {...} })`. */
interface UploadFieldSpec {
  /** Bytes or a size string such as `"5mb"`. */
  maxSize?: number | string;
  /** Exact MIME types or wildcards such as `"image/*"`. Detected by magic bytes. */
  types?: readonly string[];
  /** Declares an array field accepting up to this many files. */
  maxCount?: number;
  optional?: boolean;
  messages?: UploadMessages;
}
type UploadFieldsSpec = Record<string, UploadFieldSpec>;
interface UploadedFile {
  readonly field: string;
  /** Sanitised original filename. */
  readonly filename: string;
  /** Detected MIME type. */
  readonly mimeType: string;
  readonly size: number;
  /** Temp path when the file was written to disk. */
  readonly path?: string;
  /** Contents when the file stayed in memory. */
  readonly buffer?: Buffer;
  stream(): Readable;
  /** Moves the file out of the temp dir; skips cleanup. */
  move(to: string): Promise<string>;
  /** Leaves the file in the temp dir after the request; skips cleanup. */
  keep(): void;
  discard(): Promise<void>;
}
/** `ctx.uploads` for a given `.uploads()` spec. */
type UploadsOf<U extends UploadFieldsSpec> = Simplify<{ readonly [K in keyof U]: (U[K] extends {
  maxCount: number;
} ? UploadedFile[] : UploadedFile) | (U[K] extends {
  optional: true;
} ? undefined : never); }>;
//#endregion
//#region src/router/types.d.ts
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
/** Methods whose routes cannot declare `.body()`. */
type BodylessMethod = "GET" | "DELETE" | "HEAD" | "OPTIONS";
/** Everything the chain has accumulated about a route, carried as one type parameter. */
interface RouteState {
  readonly method: HttpMethod;
  /** Full path including router and group prefixes. */
  readonly path: string;
  readonly params: unknown;
  readonly query: unknown;
  readonly body: unknown;
  readonly headers: unknown;
  /** `undefined` until `.uploads()` is called. */
  readonly uploads: unknown;
  /** Fields added to `ctx` by middleware so far. */
  readonly adds: object;
  /** `unknown` until `.response(schema)` is called. */
  readonly response: unknown;
}
interface InitialState<M extends HttpMethod, Path extends string, Adds extends object> {
  readonly method: M;
  readonly path: Path;
  readonly params: PathParams<Path>;
  readonly query: DefaultQuery;
  readonly body: unknown;
  readonly headers: DefaultHeaders;
  readonly uploads: undefined;
  readonly adds: Adds;
  readonly response: unknown;
}
type With<S extends RouteState, K extends keyof RouteState, V> = Simplify<Omit<S, K> & { readonly [P in K]: V; }>;
/** The `ctx` a route's middleware and handler receive. */
type HandlerCtx<S extends RouteState> = TypedCtx<S["params"], S["body"], S["query"], S["headers"]> & (S["uploads"] extends undefined ? unknown : {
  readonly uploads: S["uploads"];
}) & S["adds"];
/** What a handler may return: anything, or the declared response type (plus descriptors). */
type HandlerReturn<S extends RouteState> = unknown extends S["response"] ? unknown : S["response"] | ResponseDescriptor;
type Handler<S extends RouteState> = (ctx: HandlerCtx<S>) => MaybePromise<HandlerReturn<S>>;
/** Constructor of an `HttpError` subclass, for `.errors(NotFound, ...)`. */
type HttpErrorClass = abstract new (...args: any[]) => Error & {
  readonly status: number;
  readonly code: string;
};
/**
 * Compile-time check that a params schema declares exactly the path's parameters.
 * On mismatch the parameter type gains an impossible property whose name spells
 * out the problem.
 */
type ParamsSchemaCheck<S extends StandardSchemaV1, Keys extends string> = InferInput<S> extends (infer I) ? [I] extends [object] ? [Exclude<keyof I & string, Keys>] extends [never] ? [Exclude<Keys, keyof I>] extends [never] ? unknown : {
  "~notio.error": `params schema is missing path params: ${Exclude<Keys, keyof I>}`;
} : {
  "~notio.error": `params schema has keys not in the path: ${Exclude<keyof I & string, Keys>}`;
} : {
  "~notio.error": "params schema must be an object schema";
} : never;
interface RouteBuilderBase<S extends RouteState> {
  /**
   * Validates and transforms path params. The schema must declare exactly the
   * parameters present in the path; values arrive as strings.
   */
  params<Sc extends StandardSchemaV1>(schema: Sc & ParamsSchemaCheck<Sc, ParamKeys<S["path"]>>): RouteBuilder<With<S, "params", InferOutput<Sc>>>;
  /** Validates the query string. Values arrive as strings; single values become arrays when the schema expects one. */
  query<Sc extends StandardSchemaV1>(schema: Sc): RouteBuilder<With<S, "query", InferOutput<Sc>>>;
  /** Validates request headers. Names are lower-case. */
  headers<Sc extends StandardSchemaV1>(schema: Sc): RouteBuilder<With<S, "headers", InferOutput<Sc>>>;
  /** Declares multipart file fields. Requires the upload module to be installed on the app. */
  uploads<const U extends UploadFieldsSpec>(spec: U): RouteBuilder<With<S, "uploads", UploadsOf<U>>>;
  /** Route-level middleware; runs after validation, before the handler. */
  use<M extends readonly CtxMiddlewareFor<HandlerCtx<S>>[]>(...middleware: M): RouteBuilder<With<S, "adds", S["adds"] & AddsOfAll<M>>>;
  use(...middleware: readonly express.RequestHandler[]): RouteBuilder<S>;
  use(...middleware: readonly express.ErrorRequestHandler[]): RouteBuilder<S>;
  use<M extends readonly AnyMiddleware[]>(...middleware: M): RouteBuilder<With<S, "adds", S["adds"] & AddsOfAll<M>>>;
  summary(text: string): RouteBuilder<S>;
  tags(...tags: string[]): RouteBuilder<S>;
  /**
   * Declares the success response. The handler must return a matching value
   * (or a response descriptor); outside production the return value is validated.
   */
  response<Sc extends StandardSchemaV1>(schema: Sc): RouteBuilder<With<S, "response", InferOutput<Sc>>>;
  /** Documents an additional response status. Metadata only. */
  response(status: number, schema: StandardSchemaV1): RouteBuilder<S>;
  /** Documents the errors this route may throw. */
  errors(...classes: HttpErrorClass[]): RouteBuilder<S>;
  deprecated(): RouteBuilder<S>;
  /** Excludes the route from `routes()` consumers such as OpenAPI. */
  hidden(): RouteBuilder<S>;
  /** Registers the handler. The return value becomes the response. */
  handle(handler: Handler<S>): RouteInfo;
}
interface RouteBuilderWithBody<S extends RouteState> {
  /** Validates the request body. Not available on GET, DELETE, HEAD or OPTIONS. */
  body<Sc extends StandardSchemaV1>(schema: Sc): RouteBuilder<With<S, "body", InferOutput<Sc>>>;
}
/** The chain returned by `router.get(path)` and friends. */
type RouteBuilder<S extends RouteState> = RouteBuilderBase<S> & (S["method"] extends BodylessMethod ? unknown : RouteBuilderWithBody<S>);
interface RouteSchemas {
  readonly params?: StandardSchemaV1;
  readonly query?: StandardSchemaV1;
  readonly headers?: StandardSchemaV1;
  readonly body?: StandardSchemaV1;
}
interface RouteResponse {
  readonly status: number;
  readonly schema: StandardSchemaV1;
}
/** Metadata for one registered route, as returned by `router.routes()`. */
interface RouteInfo {
  readonly method: HttpMethod;
  /** Full path including every prefix above it. */
  readonly path: string;
  /** Parameter names from the path, in order. */
  readonly params: readonly string[];
  readonly schemas: RouteSchemas;
  readonly uploads: UploadFieldsSpec | undefined;
  /** Full middleware chain, outer to inner: router, group, then route level. */
  readonly middleware: readonly AnyMiddleware[];
  /** The route-level portion of `middleware` (runs after validation). */
  readonly routeMiddleware: readonly AnyMiddleware[];
  readonly handler: Handler<RouteState>;
  /** The `.response(schema)` used to validate return values outside production. */
  readonly response: StandardSchemaV1 | undefined;
  readonly summary: string | undefined;
  readonly tags: readonly string[];
  readonly responses: readonly RouteResponse[];
  readonly errors: readonly HttpErrorClass[];
  readonly deprecated: boolean;
  readonly hidden: boolean;
}
type ServeStaticOptions = NonNullable<Parameters<typeof express.static>[1]>;
interface StaticOptions extends Omit<ServeStaticOptions, "maxAge"> {
  /** Milliseconds or a duration string such as `"1d"`. */
  maxAge?: number | string;
  /** Serve `index.html` for unmatched paths (client-side routing). */
  spa?: boolean;
}
interface StaticInfo {
  readonly path: string;
  readonly dir: string;
  readonly options: StaticOptions;
  readonly middleware: readonly AnyMiddleware[];
}
interface RedirectInfo {
  readonly from: string;
  readonly to: string;
  readonly status: number;
  readonly middleware: readonly AnyMiddleware[];
}
type RequestHook = (ctx: Ctx) => MaybePromise<void>;
type ResponseHook = (ctx: Ctx, result?: unknown) => MaybePromise<void>;
type ErrorHook = (ctx: Ctx, error: unknown) => MaybePromise<void>;
interface RouterHooks {
  readonly onRequest: readonly RequestHook[];
  readonly onResponse: readonly ResponseHook[];
  readonly onError: readonly ErrorHook[];
}
interface RouterOptions {
  /** Validate handler return values against `.response(schema)` outside production. Default `true`. */
  validateResponses?: boolean;
}
//#endregion
//#region src/router/router.d.ts
/** The `ctx` seen by router-level middleware: path params from the prefix, nothing validated yet. */
type RouterCtx<Prefix extends string, Adds extends object> = TypedCtx<PathParams<Prefix>> & Adds;
interface Router<Prefix extends string = "", Adds extends object = {}> {
  (req: Request, res: Response, next: NextFunction): void;
}
/**
 * A chainable, typed router. `Prefix` is the full path prefix (including any
 * parent group prefixes); `Adds` is what router-level middleware has put on `ctx`.
 *
 * A router is itself Express middleware: `app.use(router)` works on a bare
 * Express app, and `router.express()` returns the compiled `express.Router`.
 *
 * @example
 * const orders = new Router("/orders").use(auth.require());
 * orders.get("/:id").handle((ctx) => ctx.params.id);
 */
declare class Router<Prefix extends string = "", Adds extends object = {}> {
  readonly prefix: Prefix;
  private readonly st;
  constructor(prefix?: Prefix, options?: RouterOptions);
  /**
   * Router-level middleware. Applies to routes, groups, statics and redirects
   * registered after it. Chain the result to keep the narrowed `ctx` type.
   */
  use<M extends readonly CtxMiddlewareFor<RouterCtx<Prefix, Adds>>[]>(...middleware: M): Router<Prefix, Adds & AddsOfAll<M>>;
  use(...middleware: readonly express.RequestHandler[]): Router<Prefix, Adds>;
  use(...middleware: readonly express.ErrorRequestHandler[]): Router<Prefix, Adds>;
  use<M extends readonly AnyMiddleware[]>(...middleware: M): Router<Prefix, Adds & AddsOfAll<M>>;
  get<P extends string>(path: P): RouteBuilder<InitialState<"GET", `${Prefix}${P}`, Adds>>;
  post<P extends string>(path: P): RouteBuilder<InitialState<"POST", `${Prefix}${P}`, Adds>>;
  put<P extends string>(path: P): RouteBuilder<InitialState<"PUT", `${Prefix}${P}`, Adds>>;
  patch<P extends string>(path: P): RouteBuilder<InitialState<"PATCH", `${Prefix}${P}`, Adds>>;
  delete<P extends string>(path: P): RouteBuilder<InitialState<"DELETE", `${Prefix}${P}`, Adds>>;
  head<P extends string>(path: P): RouteBuilder<InitialState<"HEAD", `${Prefix}${P}`, Adds>>;
  options<P extends string>(path: P): RouteBuilder<InitialState<"OPTIONS", `${Prefix}${P}`, Adds>>;
  private route;
  /**
   * A child router that inherits this router's prefix and middleware. Routes
   * defined inside see the combined prefix in their param types.
   */
  group<G extends string>(prefix: G, define: (router: Router<`${Prefix}${G}`, Adds>) => void): this;
  group<G extends string, M extends readonly CtxMiddlewareFor<RouterCtx<`${Prefix}${G}`, Adds>>[]>(prefix: G, middleware: M, define: (router: Router<`${Prefix}${G}`, Adds & AddsOfAll<M>>) => void): this;
  group<G extends string, M extends readonly AnyMiddleware[]>(prefix: G, middleware: M, define: (router: Router<`${Prefix}${G}`, Adds & AddsOfAll<M>>) => void): this;
  /** Mounts a router defined elsewhere under `path`. The mounted router keeps its own prefix. */
  mount(path: string, router: Router<any, any>): this;
  /** Serves a directory with `express.static`, behind this router's prefix and middleware. */
  static(path: string, dir: string, options?: StaticOptions): this;
  redirect(from: string, to: string, status?: number): this;
  onRequest(hook: RequestHook): this;
  onResponse(hook: ResponseHook): this;
  onError(hook: ErrorHook): this;
  hooks(): RouterHooks;
  /** Every route under this router, including groups and mounts, with full paths. */
  routes(): RouteInfo[];
  /** Every static mount under this router, including groups and mounts. */
  statics(): StaticInfo[];
  redirects(): RedirectInfo[];
  /**
   * The compiled `express.Router`. Rebuilt lazily when routes were added since
   * the last call, so registering after mounting still works.
   */
  express(): express.Router;
  /** @internal Sum of this router's and every descendant's registration counters. */
  private version;
  /** @internal */
  private entries;
}
//#endregion
//#region src/app/create.d.ts
interface BodyOptions {
  /** JSON body parsing. `false` disables. Default `{ limit: "1mb" }`. */
  json?: false | {
    limit?: string | number | undefined;
    strict?: boolean | undefined;
  } | undefined;
  /** URL-encoded form parsing. `false` (the default) disables. */
  urlencoded?: false | {
    limit?: string | number | undefined;
    extended?: boolean | undefined;
  } | undefined;
}
interface HealthOptions {
  /** Liveness path; 200 once listening. Default `"/health"`. `false` disables. */
  path?: string | false | undefined;
  /** Readiness path; 200 after `onReady`, 503 while starting or shutting down. Default `"/ready"`. `false` disables. */
  ready?: string | false | undefined;
}
interface ShutdownOptions {
  /** How long to wait for in-flight requests before closing their connections. Default `"10s"`. */
  deadline?: string | number | undefined;
  /** Handle SIGTERM and SIGINT by closing and exiting. Default `true`. */
  signals?: boolean | undefined;
}
interface AppOptions {
  /** Root logger options, or an existing logger. */
  logger?: (LoggerOptionsInput & {
    startup?: boolean | undefined;
  }) | Logger$1 | undefined;
  cookies?: {
    secret?: string | string[] | undefined;
  } | undefined;
  body?: BodyOptions | undefined;
  health?: HealthOptions | false | undefined;
  shutdown?: ShutdownOptions | undefined;
}
type LifecycleHook = () => MaybePromise<void>;
/**
 * The application: a real Express instance plus the pieces `createApp` wires
 * in the right order at `listen()`.
 */
declare class App {
  #private;
  /** The raw Express instance. Registering on it directly bypasses notio's ordering. */
  readonly express: Express;
  readonly logger: Logger$1;
  /** The HTTP server, once listening. */
  server: Server | undefined;
  constructor(options?: AppOptions);
  /** App-level middleware: Express `(req, res, next)` or notio `(ctx, next)`, any mix. */
  use(...middleware: readonly CtxMiddlewareFor<Ctx>[]): this;
  use(...middleware: readonly express.RequestHandler[]): this;
  use(...middleware: readonly express.ErrorRequestHandler[]): this;
  use(...middleware: readonly AnyMiddleware[]): this;
  /** Mounts routers at their own prefix, or under `prefix`. */
  mount(...routers: Router<any, any>[]): this;
  mount(prefix: string, ...routers: Router<any, any>[]): this;
  static(path: string, dir: string, options?: StaticOptions): this;
  redirect(from: string, to: string, status?: number): this;
  /** Configures the built-in error handler. It is always registered last; never add it yourself. */
  errors(options: ErrorHandlerOptions): this;
  onRequest(hook: RequestHook): this;
  onResponse(hook: ResponseHook): this;
  onError(hook: ErrorHook): this;
  /** Runs before the server binds; async and awaited in order. */
  onStart(hook: LifecycleHook): this;
  /** Runs after the server is bound; `/ready` turns 200 afterwards. */
  onReady(hook: LifecycleHook): this;
  /** Runs after in-flight requests drained, before `close()` resolves. */
  onShutdown(hook: LifecycleHook): this;
  /** Route metadata across every mounted router, with mount prefixes applied. */
  routes(): RouteInfo[];
  get ready(): boolean;
  /**
   * Wires everything onto the Express instance in the enforced order. Called
   * by `listen()`; call it yourself only to use `app.express` with another server.
   */
  build(): Express;
  /** Runs `onStart` hooks, binds, then runs `onReady` hooks and the callback. Resolves once bound. */
  listen(port?: number, callback?: () => void): Promise<Server>;
  listen(port: number, host: string, callback?: () => void): Promise<Server>;
  /**
   * Stops accepting connections, drains in-flight requests within the
   * shutdown deadline, runs `onShutdown` hooks, and resolves. Idempotent.
   */
  close(): Promise<void>;
}
/** Creates an application. Everything is wired in the right order when `listen()` runs. */
declare function createApp(options?: AppOptions): App;
//#endregion
//#region src/cache/cache.d.ts
interface CacheOptions {
  /** A Keyv store adapter. Defaults to an in-memory Map. */
  store?: KeyvStoreAdapter | undefined;
  /** Key prefix (Keyv namespace). Default `"notio"`. */
  prefix?: string | undefined;
  /** Default TTL for `set` when none is given. Milliseconds or a duration string. */
  ttl?: number | string | undefined;
  /** Registers `close()` as a shutdown hook when given the app. */
  app?: {
    onShutdown(hook: () => Promise<void> | void): unknown;
  } | undefined;
}
interface SetOptions {
  ttl?: number | string | undefined;
}
interface CacheScope {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, options?: SetOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  /** Returns the cached value or computes, stores and returns it. Concurrent misses share one computation. */
  remember<T>(key: string, ttl: number | string | undefined, compute: () => Promise<T> | T): Promise<T>;
}
interface TaggedCache extends CacheScope {
  /** Deletes every entry set through this tag scope. */
  flush(): Promise<void>;
}
interface Cache extends CacheScope {
  clear(): Promise<void>;
  /** A scope whose `set` and `remember` associate entries with the tags. */
  tags(...tags: string[]): TaggedCache;
  /** Disconnects the store. */
  close(): Promise<void>;
  readonly keyv: Keyv;
}
/**
 * Creates a cache on Keyv. Memory by default; pass a store such as
 * `await redisStore(url)` for Redis.
 */
declare function createCache(options?: CacheOptions): Cache;
/**
 * A Redis store for {@link createCache}. Requires the optional `@keyv/redis`
 * package, imported lazily.
 */
declare function redisStore(url: string, options?: Record<string, unknown>): Promise<KeyvStoreAdapter>;
//#endregion
//#region src/config/define.d.ts
/** Nested plain objects whose leaves are Standard Schemas. */
interface ConfigShape {
  readonly [key: string]: StandardSchemaV1 | ConfigShape;
}
/** The typed, resolved configuration for a shape. */
type InferConfig<S> = Simplify<{ readonly [K in keyof S]: S[K] extends StandardSchemaV1 ? InferOutput<S[K]> : S[K] extends ConfigShape ? InferConfig<S[K]> : never; }>;
/** What a shape accepts as input: every leaf optional, raw or typed values. */
type InferConfigInput<S> = Simplify<{ readonly [K in keyof S]?: S[K] extends StandardSchemaV1 ? InferInput<S[K]> | undefined : S[K] extends ConfigShape ? InferConfigInput<S[K]> | undefined : never; }>;
interface ConfigIssue {
  /** Dotted path in the shape, e.g. `"database.url"`. */
  readonly path: string;
  /** Environment variable consulted, when resolving from the environment. */
  readonly env?: string;
  readonly message: string;
}
/** Thrown at boot with every configuration problem listed. */
declare class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];
  constructor(issues: readonly ConfigIssue[], heading?: string);
}
interface DefineConfigOptions<S extends ConfigShape> {
  /** Environment name for `.env.<env>` files. Defaults to `NODE_ENV`, then `"development"`. */
  env?: string | undefined;
  /** Directory holding the `.env` files. Defaults to `process.cwd()`. */
  cwd?: string | undefined;
  /** Read `.env` files. Defaults to `true` outside production. */
  files?: boolean | undefined;
  /** Environment variables to read. Defaults to `process.env`. */
  processEnv?: NodeJS.ProcessEnv | undefined;
  /** Highest-precedence values, typically for tests. Validated like any other source. */
  overrides?: InferConfigInput<S> | undefined;
}
type Config<S extends ConfigShape> = InferConfig<S> & {
  /** A copy for logging, with values under keys matching `/secret|password|token|key/i` redacted. */
  readonly $print: () => unknown;
};
/** `database.url` → `DATABASE_URL`, `upload.maxFileSize` → `UPLOAD_MAX_FILE_SIZE`. */
declare function envName(path: readonly string[]): string;
/**
 * Applies a shape to a plain object of values: defaults filled in, every
 * problem reported together. Module factories use it so that
 * `uploads()`, `uploads({ maxFileSize: "50mb" })` and `uploads(config.upload)`
 * are all valid.
 */
declare function resolveConfig<S extends ConfigShape>(shape: S, values: InferConfigInput<S> | undefined, name?: string): InferConfig<S>;
/**
 * Resolves configuration at boot from, in order of precedence: `overrides`,
 * process env, `.env.<env>.local`, `.env.local`, `.env.<env>`, `.env`, then
 * schema defaults. `.env` files are read only outside production. Env
 * variable names follow the path: `database.url` → `DATABASE_URL`.
 *
 * Every problem is reported in one {@link ConfigError}. The result is frozen.
 */
declare function defineConfig<S extends ConfigShape>(shape: S, options?: DefineConfigOptions<S>): Config<S>;
//#endregion
//#region src/config/env.d.ts
/**
 * A Standard Schema leaf for configuration values. Accepts the raw string an
 * environment variable provides as well as the already-typed value, so the
 * same fragment validates env, `.env` files, overrides and inline options.
 */
interface EnvSchema<Input, Output> extends StandardSchemaV1<Input, Output> {
  readonly "~standard": StandardSchemaProps<Input, Output> & {
    readonly kind: string;
    readonly defaultValue: Output | undefined;
    readonly optional: boolean;
  };
}
interface LeafOptions<T> {
  default?: T | undefined;
  optional?: boolean | undefined;
}
type Opt<T, O extends {
  optional?: boolean | undefined;
}> = O["optional"] extends true ? T | undefined : T;
declare function string<const O extends LeafOptions<string>>(options?: O): EnvSchema<string, Opt<string, O>>;
declare function number<const O extends LeafOptions<number>>(options?: O): EnvSchema<string | number, Opt<number, O>>;
declare function integer<const O extends LeafOptions<number>>(options?: O): EnvSchema<string | number, Opt<number, O>>;
declare function port<const O extends LeafOptions<number>>(options?: O): EnvSchema<string | number, Opt<number, O>>;
declare function boolean<const O extends LeafOptions<boolean>>(options?: O): EnvSchema<string | boolean, Opt<boolean, O>>;
/** A duration; strings such as `"30s"` become milliseconds. */
declare function duration<const O extends LeafOptions<number | string>>(options?: O): EnvSchema<string | number, Opt<number, O>>;
/** A byte size; strings such as `"10mb"` become bytes. */
declare function bytes<const O extends LeafOptions<number | string>>(options?: O): EnvSchema<string | number, Opt<number, O>>;
declare function url<const O extends LeafOptions<string>>(options?: O): EnvSchema<string, Opt<string, O>>;
declare function enumeration<const V extends readonly string[], const O extends LeafOptions<V[number]>>(values: V, options?: O): EnvSchema<string, Opt<V[number], O>>;
/** A comma-separated list; arrays pass through. Empty items are dropped. */
declare function list<const O extends LeafOptions<string[]>>(options?: O): EnvSchema<string | string[], Opt<string[], O>>;
/**
 * Leaf schemas for configuration. Every value accepts the environment's raw
 * string and the typed value alike. Use them in `defineConfig` shapes and in
 * module option fragments; any other Standard Schema works too.
 */
declare const env: {
  string: typeof string;
  number: typeof number;
  integer: typeof integer;
  port: typeof port;
  boolean: typeof boolean;
  duration: typeof duration;
  bytes: typeof bytes;
  url: typeof url;
  enum: typeof enumeration;
  list: typeof list;
};
//#endregion
//#region src/hooks.d.ts
/** App-level hooks accumulated on the request context. */
interface AppHooks {
  readonly onRequest: RequestHook[];
  readonly onResponse: ResponseHook[];
  readonly onError: ErrorHook[];
}
declare function createAppHooks(): AppHooks;
interface RequestLogOptions {
  /** Return `true` to skip the request line (health checks, for example). */
  ignore?: ((ctx: Ctx) => boolean) | undefined;
}
interface ContextOptions extends CtxOptions {
  onRequest?: RequestHook | readonly RequestHook[] | undefined;
  onResponse?: ResponseHook | readonly ResponseHook[] | undefined;
  onError?: ErrorHook | readonly ErrorHook[] | undefined;
  /** One `info` line per request on finish. `false` disables. Default on. */
  requestLog?: boolean | RequestLogOptions | undefined;
}
/**
 * The context middleware: creates `ctx`, makes it ambient through
 * `AsyncLocalStorage`, registers app-level hooks, and writes the request log
 * line. `createApp` installs it first; on a bare Express app use it (or
 * `hooks()`) before routes. Safe to install more than once.
 */
declare function context(options?: ContextOptions): RequestHandler;
interface HooksOptions {
  onRequest?: RequestHook | readonly RequestHook[] | undefined;
  onResponse?: ResponseHook | readonly ResponseHook[] | undefined;
  onError?: ErrorHook | readonly ErrorHook[] | undefined;
}
/**
 * Registers app-level hooks on a bare Express app by installing the context
 * middleware at this point. Call it before routes. `createApp` exposes the
 * same hooks as `app.onRequest()`, `app.onResponse()` and `app.onError()`.
 */
declare function hooks(app: Express, options: HooksOptions): void;
//#endregion
//#region src/ctx/cookies.d.ts
interface CookieJarOptions {
  /** HMAC keys for signed cookies. The first signs; all verify (rotation). */
  secret?: string | string[] | undefined;
}
declare class CookieJar implements CtxCookies {
  #private;
  constructor(ctx: Ctx, options?: CookieJarOptions);
  get(name: string): string | undefined;
  all(): Record<string, string>;
  set(name: string, value: string, options?: CookieOptions): Ctx;
  delete(name: string, options?: Pick<CookieOptions, "path" | "domain">): Ctx;
  getSigned(name: string): string | undefined;
  setSigned(name: string, value: string, options?: CookieOptions): Ctx;
}
//#endregion
//#region src/ctx/create.d.ts
interface CtxOptions {
  logger?: Logger$1 | undefined;
  /** Secret(s) for signed cookies. */
  cookieSecret?: string | string[] | undefined;
}
declare class Headers implements CtxHeaders<Record<string, unknown>> {
  #private;
  /** Set by validation when the route declares a headers schema. */
  validated: Record<string, unknown> | undefined;
  constructor(ctx: RequestContext);
  get(name: string): string | undefined;
  has(name: string): boolean;
  all(): Record<string, unknown>;
  set(name: string, value: string | number | readonly string[]): Ctx;
  append(name: string, value: string | readonly string[]): Ctx;
}
/**
 * The runtime behind {@link Ctx}. Fields the interface exposes as readonly are
 * mutable here so the router can install validated values.
 */
declare class RequestContext implements Ctx {
  #private;
  readonly kind: "http";
  readonly req: Request;
  readonly res: Response;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly state: Record<string, unknown>;
  readonly headers: Headers;
  readonly cookies: CookieJar;
  route: string | undefined;
  log: Logger$1;
  /** Status chosen with `ctx.status()`, applied to plain return values. */
  statusCode: number | undefined;
  /** Installed by the router when the route declared `.response(schema)`. */
  responseSchema: StandardSchemaV1 | undefined;
  /** App-level hooks registered by the context middleware. */
  readonly appHooks: AppHooks;
  /** The handler's return value, for app-level `onResponse`. */
  result: unknown;
  readonly startedAt: number;
  requestLogArmed: boolean;
  /** Installed by the upload module when the route declared `.uploads()`. */
  uploads: Record<string, unknown> | undefined;
  constructor(req: Request, res: Response, options?: CtxOptions);
  /**
   * Path params: the validated value once the route's params schema ran,
   * otherwise the live `req.params` (the context may predate routing).
   */
  get params(): Record<string, unknown>;
  set params(value: Record<string, unknown>);
  /** Query: validated value, otherwise `req.query` normalised to strings and string arrays. */
  get query(): Record<string, unknown>;
  set query(value: Record<string, unknown>);
  /** Body: validated value, otherwise whatever the body parser put on `req.body`. */
  get body(): unknown;
  set body(value: unknown);
  get url(): URL;
  get ip(): string;
  bearer(): string | undefined;
  accepts(...types: string[]): string | false;
  set(name: string, value: string | number | readonly string[]): this;
  status(code: number): this;
  bind(fields: Record<string, unknown>): void;
  json<T>(data: T, init?: ResponseInit): JsonResponse<T>;
  text(body: string, init?: ResponseInit): TextResponse;
  redirect(url: string, status?: number): RedirectResponse;
  file(path: string, options?: {
    type?: string;
  } & ResponseInit): FileResponse;
  download(path: string, filename?: string): DownloadResponse;
  stream(readable: Readable, options?: {
    type?: string;
  } & ResponseInit): StreamResponse;
  empty(status?: number): EmptyResponse;
  raw(write: (res: Response) => void | Promise<void>): RawResponse;
}
/** Creates the context for a request and stores it on `res.locals.ctx`. */
declare function createCtx(req: Request, res: Response, options?: CtxOptions): RequestContext;
/** The context previously created for this response, if any. */
declare function ctxOf(res: Response): RequestContext | undefined;
/** Returns the existing context or creates one. */
declare function ensureCtx(req: Request, res: Response, options?: CtxOptions): RequestContext;
//#endregion
//#region src/events/events.d.ts
/** Event names mapped to payload types, or to schemas for dev-time payload validation. */
type EventMap = Record<string, unknown>;
type PayloadOf<E extends EventMap, K extends keyof E> = E[K] extends StandardSchemaV1 ? InferOutput<E[K]> : E[K];
/** Names matched by a pattern such as `"stock.*"`. */
type MatchingNames<E extends EventMap, P extends string> = P extends `${infer Prefix}*` ? Extract<keyof E, `${Prefix}${string}`> : Extract<keyof E, P>;
interface EventMeta {
  readonly name: string;
  readonly id: string;
  readonly emittedAt: Date;
}
type Listener<P> = (payload: P, meta: EventMeta) => MaybePromise<void>;
interface ListenerError extends EventMeta {
  readonly error: unknown;
  readonly listener: Listener<never>;
}
type ErrorListener = (failure: ListenerError) => MaybePromise<void>;
interface Events<E extends EventMap> {
  /** Runs listeners in the background; resolves once they are scheduled. Errors go to `onError` and the log. */
  emit<K extends keyof E & string>(name: K, payload: PayloadOf<E, K>): Promise<void>;
  /** Runs every listener and waits; rejects if any threw (an `AggregateError` when several did). */
  emitAndWait<K extends keyof E & string>(name: K, payload: PayloadOf<E, K>): Promise<void>;
  /** Subscribes to a name or a pattern with `*`. Returns an unsubscribe function. */
  on<P extends (keyof E & string) | `${string}*`>(pattern: P, listener: Listener<PayloadOf<E, MatchingNames<E, P>>>): () => void;
  once<P extends (keyof E & string) | `${string}*`>(pattern: P, listener: Listener<PayloadOf<E, MatchingNames<E, P>>>): () => void;
  off(pattern: string, listener: Listener<never>): void;
  /** Observes listener failures from `emit`. */
  onError(listener: ErrorListener): () => void;
}
type EventSchemas<E extends EventMap> = { readonly [K in keyof E]?: StandardSchemaV1; };
interface EventsOptions<E extends EventMap> {
  /** Payload schemas by event name. Validated on emit outside production. */
  schemas?: EventSchemas<E> | undefined;
  /** Force payload validation on or off. Defaults to on outside production. */
  validate?: boolean | undefined;
}
/**
 * Creates a typed, in-process event bus.
 *
 * @example
 * type Events = { "order.placed": { orderId: string } };
 * export const events = createEvents<Events>();
 *
 * // or with schemas, validated on emit outside production:
 * export const events = createEvents({ "order.placed": OrderPlaced });
 */
declare function createEvents<E extends EventMap = Record<string, unknown>>(schemasOrOptions?: E extends Record<string, StandardSchemaV1> ? E : EventsOptions<E>): Events<E>;
declare function createEvents<const S extends Record<string, StandardSchemaV1>>(schemas: S): Events<S>;
//#endregion
//#region src/logger/proxy.d.ts
/**
 * A logger that resolves at call time: inside a request (or `runWithCtx`) it
 * is `ctx.log`, with the request id and bound fields; elsewhere it is the root
 * logger. One import works in handlers, services and scripts alike.
 */
declare const log: Logger$1;
//#endregion
//#region src/logger/root.d.ts
/** The process-wide root logger, created lazily with defaults on first use. */
declare function getRootLogger(): Logger$1;
//#endregion
//#region src/middleware/guard.d.ts
/**
 * One-line checks: continues when `predicate` is truthy, otherwise throws the
 * error produced by `error`.
 *
 * @example
 * router.use(guard((ctx) => ctx.user.role === "admin", () => new Forbidden()));
 */
declare function guard(predicate: (ctx: Ctx) => MaybePromise<unknown>, error: (ctx: Ctx) => Error): Middleware;
//#endregion
//#region src/middleware/wrap.d.ts
/**
 * Adapts a `(ctx, next)` middleware to a standalone Express handler for use
 * outside a router (app level). `await next()` resolves when the response has
 * finished, so code after it observes the outcome but can no longer change
 * headers. Express middleware passes through untouched.
 */
declare function toExpress(middleware: AnyMiddleware): RequestHandler;
//#endregion
//#region src/router/compile.d.ts
/** Marks an error whose router-level `onError` hooks already ran. */
declare const ROUTER_HANDLED: unique symbol;
declare function markHandled(error: unknown): void;
declare function wasHandledByRouter(error: unknown): boolean;
//#endregion
//#region src/router/compose.d.ts
/** Thrown internally when Express middleware calls `next("route")` or `next("router")`. */
declare class RouteSkip {
  readonly target: "route" | "router";
  constructor(target: "route" | "router");
}
declare function isDescriptor(value: unknown): value is ResponseDescriptor;
//#endregion
//#region src/router/uploads-registry.d.ts
interface ParsedUploads {
  /** `ctx.uploads` for the route: one `UploadedFile` or `UploadedFile[]` per declared field. */
  readonly uploads: Record<string, unknown>;
  /** Text fields collected from the multipart form, for `.body()` to validate. */
  readonly body: unknown;
}
/**
 * Parses a multipart request against a route's `.uploads()` spec. Registered
 * by the upload module; core has no dependency on busboy or file-type.
 */
type UploadsParser = (ctx: RequestContext, spec: UploadFieldsSpec) => Promise<ParsedUploads>;
/** @internal Called by the upload module's middleware. */
declare function setUploadsParser(fn: UploadsParser): void;
/** @internal Test-only reset. */
declare function clearUploadsParser(): void;
declare function getUploadsParser(): UploadsParser | undefined;
declare const UPLOAD_MODULE_INSTALL_MESSAGE: string;
//#endregion
//#region src/router/validate.d.ts
type ValidationSection = "params" | "query" | "headers" | "body" | "uploads" | "response";
interface ValidationIssue {
  /** Dotted path such as `"items.0.qty"`; empty string for the root. */
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly meta?: unknown;
}
interface ValidationDetails {
  readonly in: ValidationSection;
  readonly issues: readonly ValidationIssue[];
}
declare function toIssues(issues: readonly StandardIssue[]): ValidationIssue[];
type SchemaOutcome = {
  readonly ok: true;
  readonly value: unknown;
} | {
  readonly ok: false;
  readonly issues: ValidationIssue[];
};
declare function runSchema(schema: StandardSchemaV1, value: unknown): Promise<SchemaOutcome>;
declare function validationError(section: ValidationSection, issues: readonly ValidationIssue[]): Unprocessable;
//#endregion
//#region src/util/bytes.d.ts
/**
 * Parses a byte size. Numbers pass through; strings accept `b`, `kb`, `mb`,
 * `gb`, `tb` (`"10mb"`, `"1.5gb"`). A bare number string is bytes.
 */
declare function parseBytes(value: number | string, name?: string): number;
//#endregion
//#region src/util/duration.d.ts
/**
 * Parses a duration into milliseconds. Numbers pass through; strings accept
 * `ms`, `s`, `m`, `h`, `d`, `w` (`"5m"`, `"30d"`, `"1.5h"`). A bare number
 * string is milliseconds.
 */
declare function parseDuration(value: number | string, name?: string): number;
//#endregion
export { HttpErrorClass as $, defineError as $n, RouterOptions as $t, DefaultQuery as A, UploadMessage as An, PayloadTooLarge as At, EventSchemas as B, configureLogger as Bn, ResponseDescriptor as Bt, CtxHeaders as C, Unauthorized as Cn, toExpress as Cr, Next as Ct, CtxOptions as D, UploadFieldsSpec as Dn, ParsedUploads as Dt, CtxMiddlewareFor as E, UploadFieldSpec as En, wasHandledByRouter as Er, ParamsSchemaCheck as Et, ErrorHandlerOptions as F, ValidationDetails as Fn, RedirectInfo as Ft, Forbidden as G, createCtx as Gn, RouteInfo as Gt, EventsOptions as H, createApp as Hn, ResponseHook as Ht, ErrorHook as I, ValidationIssue as In, RedirectResponse as It, HandlerCtx as J, ctxOf as Jn, RouteSkip as Jt, Gone as K, createEvents as Kn, RouteResponse as Kt, ErrorListener as L, ValidationSection as Ln, RequestContext as Lt, DownloadResponse as M, UploadedFile as Mn, RESPONSE as Mt, EmptyResponse as N, UploadsOf as Nn, ROUTER_HANDLED as Nt, DEFAULT_REDACT as O, UploadIssueCode as On, PathParams as Ot, EnvSchema as P, UploadsParser as Pn, RawResponse as Pt, HttpError as Q, defineConfig as Qn, RouterHooks as Qt, EventMap as R, classifyError as Rn, RequestHook as Rt, CtxCookies as S, UPLOAD_MODULE_INSTALL_MESSAGE as Sn, setUploadsParser as Sr, MiddlewareResult as St, CtxMiddleware as T, Unprocessable as Tn, validationError as Tr, ParamKeys as Tt, ExpressMiddleware as U, createAppHooks as Un, ResponseInit as Ut, Events as V, context as Vn, ResponseHeaders as Vt, FileResponse as W, createCache as Wn, RouteBuilder as Wt, HealthOptions as X, currentCtx as Xn, Router as Xt, HandlerReturn as Y, currentBaseCtx as Yn, RouteState as Yt, HooksOptions as Z, defaultEnvelope as Zn, RouterCtx as Zt, ConfigShape as _, TaggedCache as _n, redisStore as _r, MappedError as _t, AppHooks as a, Simplify as an, getUploadsParser as ar, InitialState as at, CookieOptions as b, TypedCtx as bn, runSchema as br, MethodNotAllowed as bt, BaseCtx as c, StandardPathSegment as cn, isDescriptor as cr, LOG_LEVELS as ct, Cache as d, StandardSchemaV1 as dn, log as dr, Listener as dt, RunWithCtxOptions as en, ensureCtx as er, HttpMethod as et, CacheOptions as f, StandardSuccess as fn, markHandled as fr, ListenerError as ft, ConfigIssue as g, StreamResponse as gn, parseDuration as gr, LoggerOptionsInput as gt, ConfigError as h, StaticOptions as hn, parseBytes as hr, Logger$1 as ht, App as i, ShutdownOptions as in, getRootLogger as ir, InferOutput as it, DefineConfigOptions as j, UploadMessages as jn, PinoLogger as jt, DefaultHeaders as k, UploadIssueMeta as kn, PayloadOf as kt, BodyOptions as l, StandardResult as ln, isHttpError as lr, LeafOptions as lt, Config as m, StaticInfo as mn, paramNames as mr, LogLevel as mt, AddsOfAll as n, ServiceUnavailable as nn, envName as nr, InferConfigInput as nt, AppOptions as o, StandardFailure as on, guard as or, Internal as ot, CacheScope as p, StandardTypes as pn, notFound as pr, LogFn as pt, Handler as q, createLogger as qn, RouteSchemas as qt, AnyMiddleware as r, SetOptions as rn, errorHandler as rr, InferInput as rt, BadRequest as s, StandardIssue as sn, hooks as sr, JsonResponse as st, AddsOf as t, SchemaOutcome as tn, env as tr, InferConfig as tt, BodylessMethod as u, StandardSchemaProps as un, joinPath as ur, LifecycleHook as ut, Conflict as v, TextResponse as vn, requireCtx as vr, MatchingNames as vt, CtxKind as w, UnionToIntersection as wn, toIssues as wr, NotFound as wt, Ctx as x, UPLOAD_ISSUE_CODES as xn, runWithCtx as xr, Middleware as xt, ContextOptions as y, TooManyRequests as yn, resolveConfig as yr, MaybePromise as yt, EventMeta as z, clearUploadsParser as zn, RequestLogOptions as zt };