import { defineConfig } from "vitepress";

export default defineConfig({
  title: "notio",
  description:
    "A TypeScript web framework on Express 5: a typed router, per-request context, unified errors, hooks, logging, config, and optional modules for auth, uploads, rate limiting, and OpenAPI.",
  cleanUrls: true,
  srcDir: ".",
  outDir: ".vitepress/dist",
  appearance: "dark",
  lastUpdated: true,

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "notio — A TypeScript web framework on Express 5" }],
    [
      "meta",
      {
        property: "og:description",
        content:
          "A typed, chainable router; a per-request context; unified errors; hooks; logging; config — and optional modules for auth, uploads, rate limiting, and OpenAPI.",
      },
    ],
    ["meta", { name: "twitter:card", content: "summary" }],
    ["meta", { name: "theme-color", content: "#14b8a6" }],
  ],

  themeConfig: {
    logo: { light: "/logo.svg", dark: "/logo.svg" },

    nav: [
      { text: "Guide", link: "/guide/getting-started/installation", activeMatch: "/guide/" },
      { text: "Reference", link: "/reference/exports", activeMatch: "/reference/" },
      { text: "Examples", link: "/examples" },
      { text: "GitHub", link: "https://github.com/jetframez/notio" },
    ],

    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Installation", link: "/guide/getting-started/installation" },
          { text: "Your first app", link: "/guide/getting-started/first-app" },
          { text: "How a request flows", link: "/guide/getting-started/request-flow" },
          {
            text: "Using an existing Express app",
            link: "/guide/getting-started/existing-express",
          },
        ],
      },
      {
        text: "Core",
        items: [
          { text: "createApp", link: "/guide/core/app" },
          { text: "Router", link: "/guide/core/router" },
          { text: "Context", link: "/guide/core/ctx" },
          { text: "Middleware", link: "/guide/core/middleware" },
          { text: "Responses", link: "/guide/core/responses" },
          { text: "Errors", link: "/guide/core/errors" },
          { text: "Hooks", link: "/guide/core/hooks" },
          { text: "Config", link: "/guide/core/config" },
          { text: "Logging & ambient context", link: "/guide/core/logging" },
          { text: "Events", link: "/guide/core/events" },
          { text: "Cache", link: "/guide/core/cache" },
        ],
      },
      {
        text: "Modules",
        items: [
          { text: "Auth", link: "/guide/modules/auth" },
          { text: "Uploads", link: "/guide/modules/upload" },
          { text: "Rate limiting", link: "/guide/modules/rate-limit" },
          { text: "OpenAPI", link: "/guide/modules/openapi" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Testing", link: "/guide/guides/testing" },
          { text: "Production", link: "/guide/guides/production" },
          { text: "Recipes", link: "/guide/guides/recipes" },
        ],
      },
      {
        text: "About",
        items: [
          { text: "Design principles", link: "/guide/about/principles" },
          { text: "What notio does not do", link: "/guide/about/scope" },
        ],
      },
    ],

    outline: { level: [2, 3] },

    docFooter: { prev: "Previous", next: "Next" },

    editLink: {
      pattern: "https://github.com/jetframez/notio/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    socialLinks: [{ icon: "github", link: "https://github.com/jetframez/notio" }],

    search: {
      provider: "local",
      options: {
        detailedView: true,
      },
    },
  },
});
