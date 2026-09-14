import { describe, expect, it } from "vitest";

describe("notio", () => {
  it("re-exports the framework core", async () => {
    const core = await import("../src/index.js");
    expect(typeof core.createApp).toBe("function");
    expect(typeof core.Router).toBe("function");
    expect(typeof core.HttpError).toBe("function");
    expect(typeof core.NotFound).toBe("function");
    expect(typeof core.currentCtx).toBe("function");
    expect(typeof core.defineConfig).toBe("function");
    expect(typeof core.createEvents).toBe("function");
    expect(typeof core.createCache).toBe("function");
  });

  it("./auth re-exports the auth module", async () => {
    const auth = await import("../src/auth.js");
    expect(typeof auth.createAuth).toBe("function");
    expect(typeof auth.cookieSession).toBe("function");
    expect(typeof auth.jwt).toBe("function");
    expect(typeof auth.currentUser).toBe("function");
  });

  it("./upload re-exports the upload module", async () => {
    const upload = await import("../src/upload.js");
    expect(typeof upload.uploads).toBe("function");
    expect(Array.isArray(upload.UPLOAD_ISSUE_CODES)).toBe(true);
  });

  it("./rate-limit re-exports the rate-limit module", async () => {
    const rateLimit = await import("../src/rate-limit.js");
    expect(typeof rateLimit.rateLimit).toBe("function");
  });

  it("./openapi re-exports the openapi module", async () => {
    const openapi = await import("../src/openapi.js");
    expect(typeof openapi.openapi).toBe("function");
    expect(typeof openapi.buildDocument).toBe("function");
  });
});
