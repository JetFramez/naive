import type express from "express";
import type { Ctx, DefaultHeaders, DefaultQuery, TypedCtx } from "../ctx/types.js";
import type {
  AddsOfAll,
  AnyMiddleware,
  CtxMiddlewareFor,
  ExpressMiddleware,
} from "../middleware/types.js";
import type { ResponseDescriptor } from "../response/types.js";
import type { InferInput, InferOutput, StandardSchemaV1 } from "../schema/standard.js";
import type { MaybePromise, Simplify } from "../types.js";
import type { ParamKeys, PathParams } from "./paths.js";
import type { UploadFieldsSpec, UploadsOf } from "./uploads.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** Methods whose routes cannot declare `.body()`. */
export type BodylessMethod = "GET" | "DELETE" | "HEAD" | "OPTIONS";

/** Everything the chain has accumulated about a route, carried as one type parameter. */
export interface RouteState {
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

export interface InitialState<M extends HttpMethod, Path extends string, Adds extends object> {
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

type With<S extends RouteState, K extends keyof RouteState, V> = Simplify<
  Omit<S, K> & { readonly [P in K]: V }
>;

/** The `ctx` a route's middleware and handler receive. */
export type HandlerCtx<S extends RouteState> = TypedCtx<
  S["params"],
  S["body"],
  S["query"],
  S["headers"]
> &
  (S["uploads"] extends undefined ? unknown : { readonly uploads: S["uploads"] }) &
  S["adds"];

/** What a handler may return: anything, or the declared response type (plus descriptors). */
export type HandlerReturn<S extends RouteState> = unknown extends S["response"]
  ? unknown
  : S["response"] | ResponseDescriptor;

export type Handler<S extends RouteState> = (ctx: HandlerCtx<S>) => MaybePromise<HandlerReturn<S>>;

/** Constructor of an `HttpError` subclass, for `.errors(NotFound, ...)`. */
export type HttpErrorClass = abstract new (
  ...args: any[]
) => Error & { readonly status: number; readonly code: string };

/**
 * Compile-time check that a params schema declares exactly the path's parameters.
 * On mismatch the parameter type gains an impossible property whose name spells
 * out the problem.
 */
export type ParamsSchemaCheck<S extends StandardSchemaV1, Keys extends string> =
  InferInput<S> extends infer I
    ? [I] extends [object]
      ? [Exclude<keyof I & string, Keys>] extends [never]
        ? [Exclude<Keys, keyof I>] extends [never]
          ? unknown
          : {
              "~notio.error": `params schema is missing path params: ${Exclude<Keys, keyof I>}`;
            }
        : {
            "~notio.error": `params schema has keys not in the path: ${Exclude<keyof I & string, Keys>}`;
          }
      : { "~notio.error": "params schema must be an object schema" }
    : never;

interface RouteBuilderBase<S extends RouteState> {
  /**
   * Validates and transforms path params. The schema must declare exactly the
   * parameters present in the path; values arrive as strings.
   */
  params<Sc extends StandardSchemaV1>(
    schema: Sc & ParamsSchemaCheck<Sc, ParamKeys<S["path"]>>,
  ): RouteBuilder<With<S, "params", InferOutput<Sc>>>;

  /** Validates the query string. Values arrive as strings; single values become arrays when the schema expects one. */
  query<Sc extends StandardSchemaV1>(schema: Sc): RouteBuilder<With<S, "query", InferOutput<Sc>>>;

  /** Validates request headers. Names are lower-case. */
  headers<Sc extends StandardSchemaV1>(
    schema: Sc,
  ): RouteBuilder<With<S, "headers", InferOutput<Sc>>>;

  /** Declares multipart file fields. Requires the upload module to be installed on the app. */
  uploads<const U extends UploadFieldsSpec>(
    spec: U,
  ): RouteBuilder<With<S, "uploads", UploadsOf<U>>>;

  /** Route-level middleware; runs after validation, before the handler. */
  use<M extends readonly CtxMiddlewareFor<HandlerCtx<S>>[]>(
    ...middleware: M
  ): RouteBuilder<With<S, "adds", S["adds"] & AddsOfAll<M>>>;
  use(...middleware: readonly express.RequestHandler[]): RouteBuilder<S>;
  use(...middleware: readonly express.ErrorRequestHandler[]): RouteBuilder<S>;
  use<M extends readonly AnyMiddleware[]>(
    ...middleware: M
  ): RouteBuilder<With<S, "adds", S["adds"] & AddsOfAll<M>>>;

  summary(text: string): RouteBuilder<S>;
  tags(...tags: string[]): RouteBuilder<S>;

  /**
   * Declares the success response. The handler must return a matching value
   * (or a response descriptor); outside production the return value is validated.
   */
  response<Sc extends StandardSchemaV1>(
    schema: Sc,
  ): RouteBuilder<With<S, "response", InferOutput<Sc>>>;
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
export type RouteBuilder<S extends RouteState> = RouteBuilderBase<S> &
  (S["method"] extends BodylessMethod ? unknown : RouteBuilderWithBody<S>);

export interface RouteSchemas {
  readonly params?: StandardSchemaV1;
  readonly query?: StandardSchemaV1;
  readonly headers?: StandardSchemaV1;
  readonly body?: StandardSchemaV1;
}

export interface RouteResponse {
  readonly status: number;
  readonly schema: StandardSchemaV1;
}

/** Metadata for one registered route, as returned by `router.routes()`. */
export interface RouteInfo {
  readonly method: HttpMethod;
  /** Full path including every prefix above it. */
  readonly path: string;
  /** Parameter names from the path, in order. */
  readonly params: readonly string[];
  readonly schemas: RouteSchemas;
  readonly uploads: UploadFieldsSpec | undefined;
  /** Middleware chain, outer to inner: router, group, then route level. */
  readonly middleware: readonly AnyMiddleware[];
  readonly handler: Handler<RouteState>;
  readonly summary: string | undefined;
  readonly tags: readonly string[];
  readonly responses: readonly RouteResponse[];
  readonly errors: readonly HttpErrorClass[];
  readonly deprecated: boolean;
  readonly hidden: boolean;
}

export type ServeStaticOptions = NonNullable<Parameters<typeof express.static>[1]>;

export interface StaticOptions extends Omit<ServeStaticOptions, "maxAge"> {
  /** Milliseconds or a duration string such as `"1d"`. */
  maxAge?: number | string;
  /** Serve `index.html` for unmatched paths (client-side routing). */
  spa?: boolean;
}

export interface StaticInfo {
  readonly path: string;
  readonly dir: string;
  readonly options: StaticOptions;
  readonly middleware: readonly AnyMiddleware[];
}

export interface RedirectInfo {
  readonly from: string;
  readonly to: string;
  readonly status: number;
  readonly middleware: readonly AnyMiddleware[];
}

export type RequestHook = (ctx: Ctx) => MaybePromise<void>;
export type ResponseHook = (ctx: Ctx, result?: unknown) => MaybePromise<void>;
export type ErrorHook = (ctx: Ctx, error: unknown) => MaybePromise<void>;

export interface RouterHooks {
  readonly onRequest: readonly RequestHook[];
  readonly onResponse: readonly ResponseHook[];
  readonly onError: readonly ErrorHook[];
}

export type { ExpressMiddleware };
