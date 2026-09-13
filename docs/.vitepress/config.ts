import { defineConfig } from "vitepress";

export default defineConfig({
  title: "notio",
  description:
    "A TypeScript web framework on Express 5: a typed router, per-request context, unified errors, hooks, logging, config, and optional modules for auth, uploads, rate limiting, and OpenAPI.",
  cleanUrls: true,
  srcDir: ".",
  outDir: ".vitepress/dist",
  appearance: false,

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap",
      },
    ],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "notio — A TypeScript web framework on Express 5" }],
    ["meta", { name: "theme-color", content: "#3e9a5f" }],
  ],
});
