import { createServer, type Server } from "node:http";
import express, { type Express } from "express";
import type { Ctx } from "../ctx/types.js";
import { type ErrorHandlerOptions, errorHandler, notFound } from "../errors/handler.js";
import { context } from "../hooks.js";
import { createLogger, type LoggerOptionsInput } from "../logger/pino.js";
import { setRootLogger } from "../logger/root.js";
import type { Logger } from "../logger/types.js";
import type { AnyMiddleware, CtxMiddlewareFor } from "../middleware/types.js";
import { toExpress } from "../middleware/wrap.js";
import { Router } from "../router/router.js";
import type {
  ErrorHook,
  RequestHook,
  ResponseHook,
  RouteInfo,
  StaticOptions,
} from "../router/types.js";
import type { MaybePromise } from "../types.js";
import { parseBytes } from "../util/bytes.js";
import { parseDuration } from "../util/duration.js";

export interface BodyOptions {
  /** JSON body parsing. `false` disables. Default `{ limit: "1mb" }`. */
  json?: false | { limit?: string | number | undefined; strict?: boolean | undefined } | undefined;
  /** URL-encoded form parsing. `false` (the default) disables. */
  urlencoded?:
    | false
    | { limit?: string | number | undefined; extended?: boolean | undefined }
    | undefined;
}

export interface HealthOptions {
  /** Liveness path; 200 once listening. Default `"/health"`. `false` disables. */
  path?: string | false | undefined;
  /** Readiness path; 200 after `onReady`, 503 while starting or shutting down. Default `"/ready"`. `false` disables. */
  ready?: string | false | undefined;
}

export interface ShutdownOptions {
  /** How long to wait for in-flight requests before closing their connections. Default `"10s"`. */
  deadline?: string | number | undefined;
  /** Handle SIGTERM and SIGINT by closing and exiting. Default `true`. */
  signals?: boolean | undefined;
}

export interface AppOptions {
  /** Root logger options, or an existing logger. */
  logger?: (LoggerOptionsInput & { startup?: boolean | undefined }) | Logger | undefined;
  cookies?: { secret?: string | string[] | undefined } | undefined;
  body?: BodyOptions | undefined;
  health?: HealthOptions | false | undefined;
  shutdown?: ShutdownOptions | undefined;
}

export type LifecycleHook = () => MaybePromise<void>;

type Entry =
  | { kind: "use"; middleware: AnyMiddleware[] }
  | { kind: "router"; router: Router<any, any> };

function isLogger(value: unknown): value is Logger {
  return (
    typeof value === "object" && value !== null && typeof (value as Logger).child === "function"
  );
}

/**
 * The application: a real Express instance plus the pieces `createApp` wires
 * in the right order at `listen()`.
 */
export class App {
  /** The raw Express instance. Registering on it directly bypasses notio's ordering. */
  readonly express: Express;
  readonly logger: Logger;
  /** The HTTP server, once listening. */
  server: Server | undefined = undefined;

  readonly #options: AppOptions;
  readonly #entries: Entry[] = [];
  readonly #hooks = {
    onRequest: [] as RequestHook[],
    onResponse: [] as ResponseHook[],
    onError: [] as ErrorHook[],
    onStart: [] as LifecycleHook[],
    onReady: [] as LifecycleHook[],
    onShutdown: [] as LifecycleHook[],
  };
  #errorOptions: ErrorHandlerOptions = {};
  #built = false;
  #ready = false;
  #closing = false;
  #listening = false;
  #signalHandler: (() => void) | undefined;

  constructor(options: AppOptions = {}) {
    this.#options = options;
    this.express = express();
    const loggerOption = options.logger;
    this.logger = isLogger(loggerOption) ? loggerOption : createLogger(loggerOption);
    setRootLogger(this.logger);
  }

  /** App-level middleware: Express `(req, res, next)` or notio `(ctx, next)`, any mix. */
  use(...middleware: readonly CtxMiddlewareFor<Ctx>[]): this;
  use(...middleware: readonly express.RequestHandler[]): this;
  use(...middleware: readonly express.ErrorRequestHandler[]): this;
  use(...middleware: readonly AnyMiddleware[]): this;
  use(...middleware: readonly AnyMiddleware[]): this {
    this.#entries.push({ kind: "use", middleware: [...middleware] });
    return this;
  }

  /** Mounts routers at their own prefix, or under `prefix`. */
  mount(...routers: Router<any, any>[]): this;
  mount(prefix: string, ...routers: Router<any, any>[]): this;
  mount(first: string | Router<any, any>, ...rest: Router<any, any>[]): this {
    if (typeof first === "string") {
      for (const router of rest)
        this.#entries.push({ kind: "router", router: new Router().mount(first, router) });
    } else {
      for (const router of [first, ...rest]) this.#entries.push({ kind: "router", router });
    }
    return this;
  }

  static(path: string, dir: string, options?: StaticOptions): this {
    this.#entries.push({ kind: "router", router: new Router().static(path, dir, options) });
    return this;
  }

  redirect(from: string, to: string, status?: number): this {
    this.#entries.push({ kind: "router", router: new Router().redirect(from, to, status) });
    return this;
  }

  /** Configures the built-in error handler. It is always registered last; never add it yourself. */
  errors(options: ErrorHandlerOptions): this {
    this.#errorOptions = { ...this.#errorOptions, ...options };
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

  /** Runs before the server binds; async and awaited in order. */
  onStart(hook: LifecycleHook): this {
    this.#hooks.onStart.push(hook);
    return this;
  }

  /** Runs after the server is bound; `/ready` turns 200 afterwards. */
  onReady(hook: LifecycleHook): this {
    this.#hooks.onReady.push(hook);
    return this;
  }

  /** Runs after in-flight requests drained, before `close()` resolves. */
  onShutdown(hook: LifecycleHook): this {
    this.#hooks.onShutdown.push(hook);
    return this;
  }

  /** Route metadata across every mounted router, with mount prefixes applied. */
  routes(): RouteInfo[] {
    return this.#entries.flatMap((e) => (e.kind === "router" ? e.router.routes() : []));
  }

  get ready(): boolean {
    return this.#ready;
  }

  /**
   * Wires everything onto the Express instance in the enforced order. Called
   * by `listen()`; call it yourself only to use `app.express` with another server.
   */
  build(): Express {
    if (this.#built) return this.express;
    this.#built = true;
    const ex = this.express;
    const opts = this.#options;
    const health =
      opts.health === false ? undefined : { path: "/health", ready: "/ready", ...opts.health };
    const quiet = new Set(
      [health?.path, health?.ready].filter((p): p is string => typeof p === "string"),
    );

    ex.use(
      context({
        logger: this.logger,
        cookieSecret: opts.cookies?.secret,
        onRequest: this.#hooks.onRequest,
        onResponse: this.#hooks.onResponse,
        onError: this.#hooks.onError,
        requestLog: { ignore: (ctx) => quiet.has(ctx.path) },
      }),
    );

    const body = opts.body ?? {};
    if (body.json !== false) {
      const { limit, ...rest } = body.json ?? {};
      ex.use(express.json({ limit: parseBytes(limit ?? "1mb", "body.json.limit"), ...rest }));
    }
    if (body.urlencoded) {
      const { limit, ...rest } = body.urlencoded;
      ex.use(
        express.urlencoded({
          extended: true,
          limit: parseBytes(limit ?? "1mb", "body.urlencoded.limit"),
          ...rest,
        }),
      );
    }

    if (health?.path) {
      ex.get(health.path, (_req, res) => {
        res.status(200).json({ status: "ok" });
      });
    }
    if (health?.ready) {
      ex.get(health.ready, (_req, res) => {
        if (this.#closing) res.status(503).json({ status: "shutting-down" });
        else if (this.#ready) res.status(200).json({ status: "ready" });
        else res.status(503).json({ status: "starting" });
      });
    }

    for (const entry of this.#entries) {
      if (entry.kind === "use") ex.use(...entry.middleware.map(toExpress));
      else ex.use(entry.router);
    }

    ex.use(notFound());
    ex.use(errorHandler({ logger: this.logger, ...this.#errorOptions }));
    return ex;
  }

  /** Runs `onStart` hooks, binds, then runs `onReady` hooks and the callback. Resolves once bound. */
  async listen(port?: number, callback?: () => void): Promise<Server>;
  async listen(port: number, host: string, callback?: () => void): Promise<Server>;
  async listen(
    port?: number,
    hostOrCb?: string | (() => void),
    maybeCb?: () => void,
  ): Promise<Server> {
    if (this.#listening) throw new Error("listen() was already called");
    this.#listening = true;
    const host = typeof hostOrCb === "string" ? hostOrCb : undefined;
    const callback = typeof hostOrCb === "function" ? hostOrCb : maybeCb;
    const chosenPort = port ?? Number(process.env.PORT ?? 3000);

    this.build();
    for (const hook of this.#hooks.onStart) await hook();

    const server = createServer(this.express);
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      const onListening = () => {
        server.off("error", reject);
        resolve();
      };
      if (host === undefined) server.listen(chosenPort, onListening);
      else server.listen(chosenPort, host, onListening);
    });

    this.#installSignals();
    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : chosenPort;
    if (this.#startupLogs) this.logger.info({ port: boundPort }, `listening on port ${boundPort}`);

    for (const hook of this.#hooks.onReady) await hook();
    this.#ready = true;
    callback?.();
    return server;
  }

  /**
   * Stops accepting connections, drains in-flight requests within the
   * shutdown deadline, runs `onShutdown` hooks, and resolves. Idempotent.
   */
  async close(): Promise<void> {
    if (this.#closing) return this.#closePromise ?? Promise.resolve();
    this.#closing = true;
    this.#ready = false;
    this.#closePromise = this.#close();
    return this.#closePromise;
  }

  #closePromise: Promise<void> | undefined;

  async #close(): Promise<void> {
    this.#removeSignals();
    const server = this.server;
    if (server?.listening) {
      if (this.#startupLogs) this.logger.info("shutting down");
      const deadline = parseDuration(
        this.#options.shutdown?.deadline ?? "10s",
        "shutdown.deadline",
      );
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.logger.warn({ deadline }, "shutdown deadline reached; closing open connections");
          server.closeAllConnections();
        }, deadline);
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
        server.closeIdleConnections();
      });
    }
    for (const hook of this.#hooks.onShutdown) {
      try {
        await hook();
      } catch (error) {
        this.logger.error({ err: error }, "onShutdown hook threw");
      }
    }
    if (this.#startupLogs && server) this.logger.info("closed");
  }

  get #startupLogs(): boolean {
    const logger = this.#options.logger;
    return isLogger(logger) ? true : (logger?.startup ?? true);
  }

  #installSignals(): void {
    if (this.#options.shutdown?.signals === false) return;
    const handler = () => {
      void this.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    this.#signalHandler = handler;
    process.once("SIGTERM", handler);
    process.once("SIGINT", handler);
  }

  #removeSignals(): void {
    if (!this.#signalHandler) return;
    process.off("SIGTERM", this.#signalHandler);
    process.off("SIGINT", this.#signalHandler);
    this.#signalHandler = undefined;
  }
}

/** Creates an application. Everything is wired in the right order when `listen()` runs. */
export function createApp(options: AppOptions = {}): App {
  return new App(options);
}
