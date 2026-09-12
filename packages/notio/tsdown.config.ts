import { defineConfig } from "tsdown";

// Every @notio-internal/* package is inlined ("noExternal"): the published
// package depends only on third-party libraries, never on the internal
// packages that give the monorepo its boundaries. Shared code (core, which
// every module depends on) is naturally split into one shared chunk across
// the five entries rather than duplicated per subpath.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    auth: "src/auth.ts",
    upload: "src/upload.ts",
    "rate-limit": "src/rate-limit.ts",
    openapi: "src/openapi.ts",
  },
  format: ["esm"],
  platform: "node",
  dts: true,
  clean: true,
  fixedExtension: false,
  deps: { alwaysBundle: [/^@notio-internal\//] },
});
