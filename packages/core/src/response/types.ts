import type { Readable } from "node:stream";
import type { Response } from "express";

/** Brand carried by every response descriptor returned from `ctx.json()` and friends. */
export const RESPONSE: unique symbol = Symbol.for("naive.response");

export type ResponseHeaders = Record<string, string | number | readonly string[]>;

export interface ResponseInit {
  status?: number;
  headers?: ResponseHeaders;
}

export interface JsonResponse<T = unknown> extends ResponseInit {
  readonly [RESPONSE]: "json";
  readonly data: T;
}

export interface TextResponse extends ResponseInit {
  readonly [RESPONSE]: "text";
  readonly body: string;
}

export interface RedirectResponse {
  readonly [RESPONSE]: "redirect";
  readonly url: string;
  readonly status: number;
}

export interface FileResponse extends ResponseInit {
  readonly [RESPONSE]: "file";
  readonly path: string;
  readonly type?: string;
}

export interface DownloadResponse extends ResponseInit {
  readonly [RESPONSE]: "download";
  readonly path: string;
  readonly filename?: string;
}

export interface StreamResponse extends ResponseInit {
  readonly [RESPONSE]: "stream";
  readonly readable: Readable;
  readonly type?: string;
}

export interface EmptyResponse {
  readonly [RESPONSE]: "empty";
  readonly status: number;
}

export interface RawResponse {
  readonly [RESPONSE]: "raw";
  readonly write: (res: Response) => void | Promise<void>;
}

/** Anything a handler can return to describe the response explicitly. */
export type ResponseDescriptor =
  | JsonResponse
  | TextResponse
  | RedirectResponse
  | FileResponse
  | DownloadResponse
  | StreamResponse
  | EmptyResponse
  | RawResponse;
