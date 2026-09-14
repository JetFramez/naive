import { STATUS_CODES } from "node:http";

/**
 * Base class for every error naive sends to a client. The wire shape is always
 * `{ code, message, details?, requestId }`.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message?: string, details?: unknown) {
    super(message ?? STATUS_CODES[status] ?? "Error");
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** A subclass factory: `class TeapotError extends defineError(418, "TEAPOT") {}`. */
export function defineError(status: number, code: string) {
  return class extends HttpError {
    constructor(message?: string, details?: unknown) {
      super(status, code, message, details);
    }
  };
}

export class BadRequest extends defineError(400, "BAD_REQUEST") {}
export class Unauthorized extends defineError(401, "UNAUTHORIZED") {}
export class Forbidden extends defineError(403, "FORBIDDEN") {}
export class NotFound extends defineError(404, "NOT_FOUND") {}
export class MethodNotAllowed extends defineError(405, "METHOD_NOT_ALLOWED") {}
export class Conflict extends defineError(409, "CONFLICT") {}
export class Gone extends defineError(410, "GONE") {}
export class PayloadTooLarge extends defineError(413, "PAYLOAD_TOO_LARGE") {}
export class Unprocessable extends defineError(422, "VALIDATION") {}
export class TooManyRequests extends defineError(429, "RATE_LIMITED") {}
export class Internal extends defineError(500, "INTERNAL") {}
export class ServiceUnavailable extends defineError(503, "SERVICE_UNAVAILABLE") {}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}
