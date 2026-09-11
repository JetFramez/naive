import type express from "express";
import type { NextFunction, Request, Response } from "express";
import type { TypedCtx } from "../ctx/types.js";
import type { AddsOfAll, AnyMiddleware, CtxMiddlewareFor } from "../middleware/types.js";
import type { StandardSchemaV1 } from "../schema/standard.js";
import { compile } from "./compile.js";
import { joinPath, type PathParams, paramNames } from "./paths.js";
import type {
  CompiledRedirect,
  CompiledRoute,
  CompiledStatic,
  Entry,
  ErrorHook,
  Handler,
  HttpErrorClass,
  HttpMethod,
  InitialState,
  RedirectInfo,
  RequestHook,
  ResponseHook,
  RouteBuilder,
  RouteInfo,
  RouteResponse,
  RouterHooks,
  RouterOptions,
  RouteSchemas,
  RouteState,
  StaticInfo,
  StaticOptions,
} from "./types.js";
import type { UploadFieldsSpec } from "./uploads.js";

/** The `ctx` seen by router-level middleware: path params from the prefix, nothing validated yet. */
export type RouterCtx<Prefix extends string, Adds extends object> = TypedCtx<PathParams<Prefix>> &
  Adds;

interface MutableRoute {
  method: HttpMethod;
  path: string;
  schemas: {
    params?: StandardSchemaV1;
    query?: StandardSchemaV1;
    headers?: StandardSchemaV1;
    body?: StandardSchemaV1;
  };
  uploads: UploadFieldsSpec | undefined;
  inherited: readonly AnyMiddleware[];
  middleware: AnyMiddleware[];
  summary: string | undefined;
  tags: string[];
  response: StandardSchemaV1 | undefined;
  responses: RouteResponse[];
  errors: HttpErrorClass[];
  deprecated: boolean;
  hidden: boolean;
}

/**
 * Runtime behind {@link RouteBuilder}. Every method mutates one definition and
 * returns the same instance; the static types narrow along the chain.
 */
class RouteBuilderImpl {
  readonly #route: MutableRoute;
  readonly #register: (route: RouteInfo, inherited: readonly AnyMiddleware[]) => void;

  constructor(
    route: MutableRoute,
    register: (route: RouteInfo, inherited: readonly AnyMiddleware[]) => void,
  ) {
    this.#route = route;
    this.#register = register;
  }

  params(schema: StandardSchemaV1): this {
    this.#route.schemas.params = schema;
    return this;
  }

  query(schema: StandardSchemaV1): this {
    this.#route.schemas.query = schema;
    return this;
  }

  headers(schema: StandardSchemaV1): this {
    this.#route.schemas.headers = schema;
    return this;
  }

  body(schema: StandardSchemaV1): this {
    this.#route.schemas.body = schema;
    return this;
  }

  uploads(spec: UploadFieldsSpec): this {
    this.#route.uploads = spec;
    return this;
  }

  use(...middleware: AnyMiddleware[]): this {
    this.#route.middleware.push(...middleware);
    return this;
  }

  summary(text: string): this {
    this.#route.summary = text;
    return this;
  }

  tags(...tags: string[]): this {
    this.#route.tags.push(...tags);
    return this;
  }

  response(statusOrSchema: number | StandardSchemaV1, schema?: StandardSchemaV1): this {
    if (typeof statusOrSchema === "number") {
      if (schema) this.#route.responses.push({ status: statusOrSchema, schema });
    } else {
      this.#route.response = statusOrSchema;
      this.#route.responses.push({
        status: this.#route.method === "POST" ? 201 : 200,
        schema: statusOrSchema,
      });
    }
    return this;
  }

  errors(...classes: HttpErrorClass[]): this {
    this.#route.errors.push(...classes);
    return this;
  }

  deprecated(): this {
    this.#route.deprecated = true;
    return this;
  }

  hidden(): this {
    this.#route.hidden = true;
    return this;
  }

  handle(handler: Handler<RouteState>): RouteInfo {
    const r = this.#route;
    const info: RouteInfo = {
      method: r.method,
      path: r.path,
      params: paramNames(r.path),
      schemas: { ...r.schemas } as RouteSchemas,
      uploads: r.uploads,
      middleware: [...r.inherited, ...r.middleware],
      routeMiddleware: [...r.middleware],
      handler,
      response: r.response,
      summary: r.summary,
      tags: [...r.tags],
      responses: [...r.responses],
      errors: [...r.errors],
      deprecated: r.deprecated,
      hidden: r.hidden,
    };
    this.#register(info, r.inherited);
    return info;
  }
}

type OwnEntry =
  | { kind: "route"; info: RouteInfo; inherited: readonly AnyMiddleware[] }
  | { kind: "static"; info: StaticInfo }
  | { kind: "redirect"; info: RedirectInfo }
  | { kind: "group"; router: Router<any, any> }
  | { kind: "mount"; path: string; router: Router<any, any>; middleware: readonly AnyMiddleware[] };

interface RouterState {
  readonly options: Required<RouterOptions>;
  readonly middleware: AnyMiddleware[];
  readonly entries: OwnEntry[];
  readonly hooks: { onRequest: RequestHook[]; onResponse: ResponseHook[]; onError: ErrorHook[] };
  compiled: express.Router | undefined;
  /** Bumped on every registration so the compiled router is rebuilt lazily. */
  version: number;
  compiledVersion: number;
}

function mergeHooks(outer: RouterHooks, inner: RouterHooks): RouterHooks {
  return {
    onRequest: [...outer.onRequest, ...inner.onRequest],
    onResponse: [...outer.onResponse, ...inner.onResponse],
    onError: [...outer.onError, ...inner.onError],
  };
}

const NO_HOOKS: RouterHooks = { onRequest: [], onResponse: [], onError: [] };

interface Inherited {
  readonly path: string;
  readonly middleware: readonly AnyMiddleware[];
  readonly hooks: RouterHooks;
}

// The interface adds a call signature to the class: instances are Express middleware.
// biome-ignore lint/correctness/noUnusedVariables: type params mirror the class for declaration merging
export interface Router<Prefix extends string = "", Adds extends object = {}> {
  // biome-ignore lint/style/useShorthandFunctionType: must stay an interface to merge with the class
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
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the interface above adds the call signature
export class Router<Prefix extends string = "", Adds extends object = {}> {
  declare readonly prefix: Prefix;
  declare private readonly st: RouterState;

  constructor(prefix?: Prefix, options: RouterOptions = {}) {
    const self = function router(req: Request, res: Response, next: NextFunction): void {
      self.express()(req, res, next);
    } as unknown as Router<Prefix, Adds>;
    Object.setPrototypeOf(self, new.target.prototype);
    const state: RouterState = {
      options: { validateResponses: options.validateResponses ?? true },
      middleware: [],
      entries: [],
      hooks: { onRequest: [], onResponse: [], onError: [] },
      compiled: undefined,
      version: 0,
      compiledVersion: -1,
    };
    Object.defineProperty(self, "prefix", { value: prefix ?? "", enumerable: true });
    Object.defineProperty(self, "st", { value: state });
    // biome-ignore lint/correctness/noConstructorReturn: the instance must be a callable function object
    return self;
  }

  /**
   * Router-level middleware. Applies to routes, groups, statics and redirects
   * registered after it. Chain the result to keep the narrowed `ctx` type.
   */
  use<M extends readonly CtxMiddlewareFor<RouterCtx<Prefix, Adds>>[]>(
    ...middleware: M
  ): Router<Prefix, Adds & AddsOfAll<M>>;
  use(...middleware: readonly express.RequestHandler[]): Router<Prefix, Adds>;
  use(...middleware: readonly express.ErrorRequestHandler[]): Router<Prefix, Adds>;
  use<M extends readonly AnyMiddleware[]>(...middleware: M): Router<Prefix, Adds & AddsOfAll<M>>;
  use(...middleware: readonly AnyMiddleware[]): Router<Prefix, any> {
    this.st.middleware.push(...middleware);
    return this;
  }

  get<P extends string>(path: P): RouteBuilder<InitialState<"GET", `${Prefix}${P}`, Adds>> {
    return this.route("GET", path);
  }

  post<P extends string>(path: P): RouteBuilder<InitialState<"POST", `${Prefix}${P}`, Adds>> {
    return this.route("POST", path);
  }

  put<P extends string>(path: P): RouteBuilder<InitialState<"PUT", `${Prefix}${P}`, Adds>> {
    return this.route("PUT", path);
  }

  patch<P extends string>(path: P): RouteBuilder<InitialState<"PATCH", `${Prefix}${P}`, Adds>> {
    return this.route("PATCH", path);
  }

  delete<P extends string>(path: P): RouteBuilder<InitialState<"DELETE", `${Prefix}${P}`, Adds>> {
    return this.route("DELETE", path);
  }

  head<P extends string>(path: P): RouteBuilder<InitialState<"HEAD", `${Prefix}${P}`, Adds>> {
    return this.route("HEAD", path);
  }

  options<P extends string>(path: P): RouteBuilder<InitialState<"OPTIONS", `${Prefix}${P}`, Adds>> {
    return this.route("OPTIONS", path);
  }

  private route(method: HttpMethod, path: string): any {
    const route: MutableRoute = {
      method,
      path: joinPath(this.prefix, path),
      schemas: {},
      uploads: undefined,
      inherited: [...this.st.middleware],
      middleware: [],
      summary: undefined,
      tags: [],
      response: undefined,
      responses: [],
      errors: [],
      deprecated: false,
      hidden: false,
    };
    return new RouteBuilderImpl(route, (info, inherited) => {
      this.st.entries.push({ kind: "route", info, inherited });
      this.st.version++;
    });
  }

  /**
   * A child router that inherits this router's prefix and middleware. Routes
   * defined inside see the combined prefix in their param types.
   */
  group<G extends string>(prefix: G, define: (router: Router<`${Prefix}${G}`, Adds>) => void): this;
  group<G extends string, M extends readonly CtxMiddlewareFor<RouterCtx<`${Prefix}${G}`, Adds>>[]>(
    prefix: G,
    middleware: M,
    define: (router: Router<`${Prefix}${G}`, Adds & AddsOfAll<M>>) => void,
  ): this;
  group<G extends string, M extends readonly AnyMiddleware[]>(
    prefix: G,
    middleware: M,
    define: (router: Router<`${Prefix}${G}`, Adds & AddsOfAll<M>>) => void,
  ): this;
  group(
    prefix: string,
    middlewareOrDefine: readonly AnyMiddleware[] | ((router: Router<any, any>) => void),
    maybeDefine?: (router: Router<any, any>) => void,
  ): this {
    const middleware = Array.isArray(middlewareOrDefine) ? middlewareOrDefine : [];
    const define =
      typeof middlewareOrDefine === "function" ? middlewareOrDefine : (maybeDefine ?? (() => {}));
    const child = new Router(joinPath(this.prefix, prefix), this.st.options);
    child.st.middleware.push(...this.st.middleware, ...middleware);
    this.st.entries.push({ kind: "group", router: child });
    this.st.version++;
    define(child);
    return this;
  }

  /** Mounts a router defined elsewhere under `path`. The mounted router keeps its own prefix. */
  mount(path: string, router: Router<any, any>): this {
    this.st.entries.push({ kind: "mount", path, router, middleware: [...this.st.middleware] });
    this.st.version++;
    return this;
  }

  /** Serves a directory with `express.static`, behind this router's prefix and middleware. */
  static(path: string, dir: string, options: StaticOptions = {}): this {
    this.st.entries.push({
      kind: "static",
      info: {
        path: joinPath(this.prefix, path),
        dir,
        options,
        middleware: [...this.st.middleware],
      },
    });
    this.st.version++;
    return this;
  }

  redirect(from: string, to: string, status = 302): this {
    this.st.entries.push({
      kind: "redirect",
      info: { from: joinPath(this.prefix, from), to, status, middleware: [...this.st.middleware] },
    });
    this.st.version++;
    return this;
  }

  onRequest(hook: RequestHook): this {
    this.st.hooks.onRequest.push(hook);
    return this;
  }

  onResponse(hook: ResponseHook): this {
    this.st.hooks.onResponse.push(hook);
    return this;
  }

  onError(hook: ErrorHook): this {
    this.st.hooks.onError.push(hook);
    return this;
  }

  hooks(): RouterHooks {
    return this.st.hooks;
  }

  /** Every route under this router, including groups and mounts, with full paths. */
  routes(): RouteInfo[] {
    return this.entries().flatMap((e) => (e.kind === "route" ? [e.route.info] : []));
  }

  /** Every static mount under this router, including groups and mounts. */
  statics(): StaticInfo[] {
    return this.entries().flatMap((e) => (e.kind === "static" ? [stripHooks(e.static)] : []));
  }

  redirects(): RedirectInfo[] {
    return this.entries().flatMap((e) => (e.kind === "redirect" ? [stripHooks(e.redirect)] : []));
  }

  /**
   * The compiled `express.Router`. Rebuilt lazily when routes were added since
   * the last call, so registering after mounting still works.
   */
  express(): express.Router {
    const st = this.st;
    if (!st.compiled || st.compiledVersion !== this.version()) {
      st.compiled = compile(this.entries(), st.options);
      st.compiledVersion = this.version();
    }
    return st.compiled;
  }

  /** @internal Sum of this router's and every descendant's registration counters. */
  private version(): number {
    let total = this.st.version;
    for (const e of this.st.entries) {
      if (e.kind === "group" || e.kind === "mount") total += e.router.version();
    }
    return total;
  }

  /** @internal */
  private entries(inherited: Inherited = { path: "", middleware: [], hooks: NO_HOOKS }): Entry[] {
    const hooks = mergeHooks(inherited.hooks, this.st.hooks);
    const out: Entry[] = [];
    for (const e of this.st.entries) {
      switch (e.kind) {
        case "route": {
          const info: RouteInfo = {
            ...e.info,
            path: joinPath(inherited.path, e.info.path),
            middleware: [...inherited.middleware, ...e.info.middleware],
          };
          const route: CompiledRoute = {
            info,
            inherited: [...inherited.middleware, ...e.inherited],
            hooks,
          };
          out.push({ kind: "route", route });
          break;
        }
        case "static": {
          const s: CompiledStatic = {
            ...e.info,
            path: joinPath(inherited.path, e.info.path),
            middleware: [...inherited.middleware, ...e.info.middleware],
            hooks,
          };
          out.push({ kind: "static", static: s });
          break;
        }
        case "redirect": {
          const r: CompiledRedirect = {
            ...e.info,
            from: joinPath(inherited.path, e.info.from),
            middleware: [...inherited.middleware, ...e.info.middleware],
            hooks,
          };
          out.push({ kind: "redirect", redirect: r });
          break;
        }
        case "group":
          out.push(
            ...e.router.entries({ path: inherited.path, middleware: inherited.middleware, hooks }),
          );
          break;
        case "mount":
          out.push(
            ...e.router.entries({
              path: joinPath(inherited.path, joinPath(this.prefix, e.path)),
              middleware: [...inherited.middleware, ...e.middleware],
              hooks,
            }),
          );
          break;
      }
    }
    return out;
  }
}

function stripHooks<T extends { hooks: RouterHooks }>(entry: T): Omit<T, "hooks"> {
  const { hooks: _hooks, ...rest } = entry;
  return rest;
}
