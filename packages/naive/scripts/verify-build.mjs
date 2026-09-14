#!/usr/bin/env node
// Confirms the published output has no leftover imports of the internal
// workspace packages (they must be inlined) and that every subpath actually
// loads and exports its documented surface. Run after `pnpm build`.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

const files = (await readdir(distDir)).filter((f) => f.endsWith(".js"));
let leaked = false;
for (const file of files) {
  const contents = await readFile(join(distDir, file), "utf8");
  const importLine = /(?:from|require\()\s*["']@naive-internal\//;
  if (importLine.test(contents)) {
    console.error(`✗ ${file} still imports a workspace package instead of inlining it`);
    leaked = true;
  }
}
if (leaked) process.exit(1);
console.log(`✓ no workspace-package imports leaked into ${files.length} built files`);

const checks = [
  ["index.js", ["createApp", "Router", "HttpError"]],
  ["auth.js", ["createAuth", "cookieSession"]],
  ["upload.js", ["uploads"]],
  ["rate-limit.js", ["rateLimit"]],
  ["openapi.js", ["openapi", "buildDocument"]],
];
for (const [file, names] of checks) {
  const mod = await import(join(distDir, file));
  for (const name of names) {
    if (typeof mod[name] !== "function") {
      console.error(`✗ ${file} does not export "${name}"`);
      process.exit(1);
    }
  }
}
console.log(`✓ every subpath loads and exports its documented surface`);
