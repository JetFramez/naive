import type { AddressInfo } from "node:net";
import { type App, createApp, createLogger } from "@naive-internal/core";

export type LooseResponse = Omit<Response, "json"> & { json(): Promise<any> };

export interface TestServer {
  readonly app: App;
  fetch(path: string, init?: RequestInit): Promise<LooseResponse>;
  close(): Promise<void>;
}

function quietLogger() {
  return createLogger({ level: "fatal", pretty: false, destination: { write() {} } });
}

export async function serve(setup: (app: App) => void): Promise<TestServer> {
  const app = createApp({ logger: quietLogger(), shutdown: { signals: false } });
  setup(app);
  const server = await app.listen(0, "127.0.0.1");
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  return {
    app,
    fetch: (path, init) => fetch(`${base}${path}`, { redirect: "manual", ...init }),
    close: () => app.close(),
  };
}

export async function withApp(
  setup: (app: App) => void,
  fn: (server: TestServer) => Promise<void>,
): Promise<void> {
  const server = await serve(setup);
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}
