import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "notio",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    conditions: ["development"],
  },
});
