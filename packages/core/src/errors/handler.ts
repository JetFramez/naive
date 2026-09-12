import { STATUS_CODES } from "node:http";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ensureCtx } from "../ctx/create.js";
import type { Ctx } from "../ctx/types.js";
import { runHooksSafely } from "../hooks.js";
import type { Logger } from "../logger/types.js";
import { wasHandledByRouter } from "../router/compile.js";
import { toIssues } from "../router/validate.js";
import type { StandardIssue } from "../schema/standard.js";
import { type HttpError, isHttpError, NotFound } from "./http-error.js";

/** What the classifier produces for any thrown value. */
export interface MappedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export interface ErrorHandlerOptions {
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
  logger?: Logger | undefined;
}

function codeForStatus(status: number): string {
  const text = STATUS_CODES[status] ?? "Error";
  return text
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();
}

function numericStatus(error: Record<string, unknown>): number | undefined {
  for (const key of ["status", "statusCode"]) {
    const value = error[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599) {
      return value;
    }
  }
  return undefined;
}

function looksLikeIssues(value: unknown): value is StandardIssue[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (issue) => typeof issue === "object" && issue !== null && typeof issue.message === "string",
    )
  );
}

function fallbackMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === "string" ? error : "Unknown error";
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
export function classifyError(error: unknown, expose: boolean): MappedError {
  if (isHttpError(error)) {
    return error.details === undefined
      ? { status: error.status, code: error.code, message: error.message }
      : { status: error.status, code: error.code, message: error.message, details: error.details };
  }
  if (typeof error === "object" && error !== null) {
    const err = error as Record<string, unknown>;

    if (looksLikeIssues(err.issues)) {
      return {
        status: 422,
        code: "VALIDATION",
        message: "Validation failed",
        details: { issues: toIssues(err.issues) },
      };
    }

    if (err.type === "entity.parse.failed") {
      return { status: 400, code: "BAD_REQUEST", message: "Malformed request body" };
    }
    if (err.type === "entity.too.large") {
      return {
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body too large",
        details: { limit: err.limit, length: err.length },
      };
    }

    const status = numericStatus(err);
    if (status !== undefined) {
      const message =
        err.expose === true && typeof err.message === "string" && err.message
          ? err.message
          : (STATUS_CODES[status] ?? "Error");
      return { status, code: codeForStatus(status), message };
    }
  }
  return {
    status: 500,
    code: "INTERNAL",
    message: expose ? fallbackMessage(error) : "Internal Server Error",
  };
}

function defaultExpose(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** The default wire shape. `stack` is present only for exposed 5xx errors. */
export function defaultEnvelope(mapped: MappedError, ctx: Ctx, stack?: string): unknown {
  return {
    code: mapped.code,
    message: mapped.message,
    ...(mapped.details === undefined ? {} : { details: mapped.details }),
    requestId: ctx.requestId,
    ...(stack === undefined ? {} : { stack }),
  };
}

/**
 * Express error handler that renders every error in the unified shape. Register
 * it last on a bare Express app; `createApp` installs it for you and
 * `app.errors()` configures it.
 */
export function errorHandler(options: ErrorHandlerOptions = {}): ErrorRequestHandler {
  const expose = options.expose ?? defaultExpose();
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const ctx = ensureCtx(req, res, { logger: options.logger });
    if (!wasHandledByRouter(error) && ctx.appHooks.onError.length > 0) {
      void runHooksSafely(ctx, ctx.appHooks.onError, [ctx, error]).then(() => render(error));
      return;
    }
    render(error);

    function render(error: unknown): void {
      let mapped: MappedError | undefined;
      let source: unknown = error;
      try {
        const custom = options.map?.(error, ctx);
        if (isHttpError(custom)) mapped = classifyError(custom, expose);
        else if (custom) mapped = custom;
      } catch (mapError) {
        source = mapError;
      }
      mapped ??= classifyError(source, expose);

      if (mapped.status >= 500) {
        ctx.log.error(
          { err: source, status: mapped.status, code: mapped.code, route: ctx.route },
          mapped.message,
        );
      }

      const stack =
        expose && mapped.status >= 500 && source instanceof Error ? source.stack : undefined;
      const body = options.format
        ? options.format(mapped, ctx)
        : defaultEnvelope(mapped, ctx, stack);
      res.status(mapped.status);
      if (body === undefined || body === null) {
        res.end();
      } else if (typeof body === "string") {
        res.send(body);
      } else {
        res.json(body);
      }
    }
  };
}

/**
 * Terminal handler that turns an unmatched request into `NotFound`, so the
 * error handler renders it. `createApp` installs it after everything else.
 */
export function notFound(): RequestHandler {
  return (req, _res, next) => {
    next(new NotFound(`No route for ${req.method} ${req.originalUrl.split("?")[0]}`));
  };
}
