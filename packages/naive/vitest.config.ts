import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "naive",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    conditions: ["development"],
  },
});
