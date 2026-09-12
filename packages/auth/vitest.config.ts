import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "auth",
    include: ["test/**/*.test.ts"],
    typecheck: {
      enabled: true,
      include: ["test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
  },
  resolve: {
    conditions: ["development"],
  },
});
