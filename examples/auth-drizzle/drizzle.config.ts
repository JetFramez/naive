import { defineConfig } from "drizzle-kit";

// Not used at runtime — this example bootstraps its schema directly (see
// src/db.ts). This config is here so `drizzle-kit studio`/`generate` work if
// you outgrow the inline CREATE TABLE and want real migrations.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_PATH ?? "auth-drizzle.sqlite" },
});
