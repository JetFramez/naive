import type express from "express";
import type { TypedCtx } from "../ctx/types.js";
import type { AddsOfAll, AnyMiddleware, CtxMiddlewareFor } from "../middleware/types.js";
import type { StandardSchemaV1 } from "../schema/standard.js";
import { joinPath, type PathParams, paramNames } from "./paths.js";
import type {
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
  readonly #register: (route: RouteInfo) => void;

  constructor(route: MutableRoute, register: (route: RouteInfo) => void) {
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
      handler,
      summary: r.summary,
      tags: [...r.tags],
      responses: [...r.responses],
      errors: [...r.errors],
      deprecated: r.deprecated,
      hidden: r.hidden,
    };
    this.#register(info);
    return info;
  }
}

interface MountEntry {
  readonly path: string;
  readonly router: Router<any, any>;
  /** Parent middleware at mount time. */
  readonly middleware: readonly AnyMiddleware[];
}

/**
 * A chainable, typed router. `Prefix` is the full path prefix (including any
 * parent group prefixes); `Adds` is what router-level middleware has put on `ctx`.
 *
 * @example
 * const orders = new Router("/orders")
 *   .use(auth.require());
 * orders.get("/:id").handle((ctx) => ctx.params.id);
 */
export class Router<Prefix extends string = "", Adds extends object = {}> {
  readonly prefix: Prefix;
  readonly #middleware: AnyMiddleware[];
  readonly #routes: RouteInfo[] = [];
  readonly #groups: Router<any, any>[] = [];
  readonly #mounts: MountEntry[] = [];
  readonly #statics: StaticInfo[] = [];
  readonly #redirects: RedirectInfo[] = [];
  readonly #hooks: { onRequest: RequestHook[]; onResponse: ResponseHook[]; onError: ErrorHook[] } =
    { onRequest: [], onResponse: [], onError: [] };

  constructor(prefix?: Prefix, inherited: readonly AnyMiddleware[] = []) {
    this.prefix = (prefix ?? "") as Prefix;
    this.#middleware = [...inherited];
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
    this.#middleware.push(...middleware);
    return this;
  }

  get<P extends string>(path: P): RouteBuilder<InitialState<"GET", `${Prefix}${P}`, Adds>> {
    return this.#route("GET", path);
  }

  post<P extends string>(path: P): RouteBuilder<InitialState<"POST", `${Prefix}${P}`, Adds>> {
    return this.#route("POST", path);
  }

  put<P extends string>(path: P): RouteBuilder<InitialState<"PUT", `${Prefix}${P}`, Adds>> {
    return this.#route("PUT", path);
  }

  patch<P extends string>(path: P): RouteBuilder<InitialState<"PATCH", `${Prefix}${P}`, Adds>> {
    return this.#route("PATCH", path);
  }

  delete<P extends string>(path: P): RouteBuilder<InitialState<"DELETE", `${Prefix}${P}`, Adds>> {
    return this.#route("DELETE", path);
  }

  head<P extends string>(path: P): RouteBuilder<InitialState<"HEAD", `${Prefix}${P}`, Adds>> {
    return this.#route("HEAD", path);
  }

  options<P extends string>(path: P): RouteBuilder<InitialState<"OPTIONS", `${Prefix}${P}`, Adds>> {
    return this.#route("OPTIONS", path);
  }

  #route(method: HttpMethod, path: string): any {
    const route: MutableRoute = {
      method,
      path: joinPath(this.prefix, path),
      schemas: {},
      uploads: undefined,
      inherited: [...this.#middleware],
      middleware: [],
      summary: undefined,
      tags: [],
      responses: [],
      errors: [],
      deprecated: false,
      hidden: false,
    };
    const builder = new RouteBuilderImpl(route, (info) => this.#routes.push(info));
    return builder;
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
    const child = new Router(joinPath(this.prefix, prefix), [...this.#middleware, ...middleware]);
    this.#groups.push(child);
    define(child);
    return this;
  }

  /** Mounts a router defined elsewhere under `path`. The mounted router keeps its own prefix. */
  mount(path: string, router: Router<any, any>): this {
    this.#mounts.push({ path, router, middleware: [...this.#middleware] });
    return this;
  }

  /** Serves a directory with `express.static`, behind this router's prefix and middleware. */
  static(path: string, dir: string, options: StaticOptions = {}): this {
    this.#statics.push({
      path: joinPath(this.prefix, path),
      dir,
      options,
      middleware: [...this.#middleware],
    });
    return this;
  }

  redirect(from: string, to: string, status = 302): this {
    this.#redirects.push({
      from: joinPath(this.prefix, from),
      to,
      status,
      middleware: [...this.#middleware],
    });
    return this;
  }

  onRequest(hook: RequestHook): this {
    this.#hooks.onRequest.push(hook);
    return this;
  }

  onResponse(hook: ResponseHook): this {
    this.#hooks.onResponse.push(hook);
    return this;
  }

  onError(hook: ErrorHook): this {
    this.#hooks.onError.push(hook);
    return this;
  }

  hooks(): RouterHooks {
    return this.#hooks;
  }

  /** Every route under this router, including groups and mounts, with full paths. */
  routes(): RouteInfo[] {
    return this.collect("", []);
  }

  /** Every static mount under this router, including groups and mounts. */
  statics(): StaticInfo[] {
    return this.collectStatics("", []);
  }

  redirects(): RedirectInfo[] {
    return this.collectRedirects("", []);
  }

  /** @internal */
  collect(basePath: string, baseMiddleware: readonly AnyMiddleware[]): RouteInfo[] {
    const own = this.#routes.map((r) => ({
      ...r,
      path: joinPath(basePath, r.path),
      middleware: [...baseMiddleware, ...r.middleware],
    }));
    const grouped = this.#groups.flatMap((g) => g.collect(basePath, baseMiddleware));
    const mounted = this.#mounts.flatMap((m) =>
      m.router.collect(joinPath(basePath, joinPath(this.prefix, m.path)), [
        ...baseMiddleware,
        ...m.middleware,
      ]),
    );
    return [...own, ...grouped, ...mounted];
  }

  /** @internal */
  collectStatics(basePath: string, baseMiddleware: readonly AnyMiddleware[]): StaticInfo[] {
    const own = this.#statics.map((s) => ({
      ...s,
      path: joinPath(basePath, s.path),
      middleware: [...baseMiddleware, ...s.middleware],
    }));
    const grouped = this.#groups.flatMap((g) => g.collectStatics(basePath, baseMiddleware));
    const mounted = this.#mounts.flatMap((m) =>
      m.router.collectStatics(joinPath(basePath, joinPath(this.prefix, m.path)), [
        ...baseMiddleware,
        ...m.middleware,
      ]),
    );
    return [...own, ...grouped, ...mounted];
  }

  /** @internal */
  collectRedirects(basePath: string, baseMiddleware: readonly AnyMiddleware[]): RedirectInfo[] {
    const own = this.#redirects.map((r) => ({
      ...r,
      from: joinPath(basePath, r.from),
      middleware: [...baseMiddleware, ...r.middleware],
    }));
    const grouped = this.#groups.flatMap((g) => g.collectRedirects(basePath, baseMiddleware));
    const mounted = this.#mounts.flatMap((m) =>
      m.router.collectRedirects(joinPath(basePath, joinPath(this.prefix, m.path)), [
        ...baseMiddleware,
        ...m.middleware,
      ]),
    );
    return [...own, ...grouped, ...mounted];
  }
}
