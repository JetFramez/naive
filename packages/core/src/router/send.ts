import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";
import type { RequestContext } from "../ctx/create.js";
import type { ResponseDescriptor, ResponseHeaders } from "../response/types.js";
import { RESPONSE } from "../response/types.js";
import { isDescriptor } from "./compose.js";

const OCTET = "application/octet-stream";

function applyHeaders(res: Response, headers: ResponseHeaders | undefined): void {
  if (!headers) return;
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value as string | number | string[]);
  }
}

function defaultType(res: Response, type: string): void {
  if (!res.getHeader("content-type")) res.type(type);
}

function defaultStatus(ctx: RequestContext): number {
  return ctx.statusCode ?? (ctx.method === "POST" ? 201 : 200);
}

async function pipeStream(ctx: RequestContext, readable: Readable): Promise<void> {
  try {
    await pipeline(readable, ctx.res);
  } catch (error) {
    if (!ctx.res.headersSent) throw error;
    ctx.log.warn({ err: error }, "stream ended early");
  }
}

function callback(res: Response, run: (cb: (err?: unknown) => void) => void): Promise<void> {
  return new Promise<void>((resolveP, reject) => {
    run((err) => {
      if (!err) return resolveP();
      // Express reports a client that went away after headers were sent; nothing to do.
      if (res.headersSent) return resolveP();
      reject(err);
    });
  });
}

async function sendDescriptor(ctx: RequestContext, d: ResponseDescriptor): Promise<void> {
  const res = ctx.res;
  switch (d[RESPONSE]) {
    case "json":
      applyHeaders(res, d.headers);
      res.status(d.status ?? defaultStatus(ctx)).json(d.data);
      return;
    case "text":
      applyHeaders(res, d.headers);
      defaultType(res, "text/plain");
      res.status(d.status ?? ctx.statusCode ?? 200).send(d.body);
      return;
    case "redirect":
      res.redirect(d.status, d.url);
      return;
    case "file": {
      applyHeaders(res, d.headers);
      if (d.type) res.type(d.type);
      if (d.status ?? ctx.statusCode) res.status(d.status ?? ctx.statusCode ?? 200);
      await callback(res, (cb) => res.sendFile(resolve(d.path), cb));
      return;
    }
    case "download": {
      applyHeaders(res, d.headers);
      const path = resolve(d.path);
      await callback(res, (cb) =>
        d.filename === undefined ? res.download(path, cb) : res.download(path, d.filename, cb),
      );
      return;
    }
    case "stream":
      applyHeaders(res, d.headers);
      defaultType(res, d.type ?? OCTET);
      res.status(d.status ?? ctx.statusCode ?? 200);
      await pipeStream(ctx, d.readable);
      return;
    case "empty":
      res.status(d.status).end();
      return;
    case "raw":
      await d.write(res);
      return;
  }
}

/**
 * Turns a handler's return value into a response, following the conventions:
 * string → text, undefined → 204, Buffer/Readable → bytes, descriptor → as
 * described, anything else → JSON (201 for POST).
 */
export async function sendResult(ctx: RequestContext, result: unknown): Promise<void> {
  const res = ctx.res;
  if (res.headersSent) {
    if (result !== undefined) {
      ctx.log.warn(
        { route: ctx.route },
        "handler wrote to ctx.res and also returned a value; the value was ignored",
      );
    }
    return;
  }
  if (isDescriptor(result)) return sendDescriptor(ctx, result);
  if (result === undefined) {
    res.status(ctx.statusCode ?? 204).end();
    return;
  }
  if (typeof result === "string") {
    defaultType(res, "text/plain");
    res.status(ctx.statusCode ?? 200).send(result);
    return;
  }
  if (Buffer.isBuffer(result)) {
    defaultType(res, OCTET);
    res.status(ctx.statusCode ?? 200).send(result);
    return;
  }
  if (result instanceof Readable) {
    defaultType(res, OCTET);
    res.status(ctx.statusCode ?? 200);
    await pipeStream(ctx, result);
    return;
  }
  res.status(defaultStatus(ctx)).json(result);
}
