import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { errorHandler, notFound } from "../../src/index.js";

/** A fetch Response whose `json()` is untyped, for convenient assertions. */
export type LooseResponse = Omit<Response, "json"> & { json(): Promise<any> };

export interface TestServer {
  readonly app: Express;
  readonly url: string;
  fetch(path: string, init?: RequestInit): Promise<LooseResponse>;
  close(): Promise<void>;
}

export async function serve(setup: (app: Express) => void): Promise<TestServer> {
  const app = express();
  setup(app);
  app.use(notFound());
  app.use(errorHandler({ expose: true }));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  return {
    app,
    url,
    fetch: (path, init) => fetch(`${url}${path}`, { redirect: "manual", ...init }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Runs `fn` against a freshly served app and always closes it. */
export async function withApp(
  setup: (app: Express) => void,
  fn: (server: TestServer) => Promise<void>,
): Promise<void> {
  const server = await serve(setup);
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

export const json = (body: unknown, init: RequestInit = {}): RequestInit => ({
  method: "POST",
  ...init,
  headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  body: JSON.stringify(body),
});
