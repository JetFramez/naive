// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://jetframez.github.io",
  base: "/notio",
  integrations: [
    starlight({
      title: "notio",
      description:
        "A TypeScript web framework on Express 5: a typed router, per-request context, unified errors, hooks, logging, config, and optional modules for auth, uploads, rate limiting, and OpenAPI.",
      logo: { src: "./src/assets/logo.svg" },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/jetframez/notio" }],
      editLink: {
        baseUrl: "https://github.com/jetframez/notio/edit/main/docs/src/content/docs/",
      },
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Installation", slug: "guide/getting-started/installation" },
            { label: "Your first app", slug: "guide/getting-started/first-app" },
            { label: "How a request flows", slug: "guide/getting-started/request-flow" },
            {
              label: "Using an existing Express app",
              slug: "guide/getting-started/existing-express",
            },
          ],
        },
        {
          label: "Core",
          items: [
            { label: "createApp", slug: "guide/core/app" },
            { label: "Router", slug: "guide/core/router" },
            { label: "Context", slug: "guide/core/ctx" },
            { label: "Middleware", slug: "guide/core/middleware" },
            { label: "Responses", slug: "guide/core/responses" },
            { label: "Errors", slug: "guide/core/errors" },
            { label: "Hooks", slug: "guide/core/hooks" },
            { label: "Config", slug: "guide/core/config" },
            { label: "Logging & ambient context", slug: "guide/core/logging" },
            { label: "Events", slug: "guide/core/events" },
            { label: "Cache", slug: "guide/core/cache" },
          ],
        },
        {
          label: "Modules",
          items: [
            { label: "Auth", slug: "guide/modules/auth" },
            { label: "Uploads", slug: "guide/modules/upload" },
            { label: "Rate limiting", slug: "guide/modules/rate-limit" },
            { label: "OpenAPI", slug: "guide/modules/openapi" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Testing", slug: "guide/guides/testing" },
            { label: "Production", slug: "guide/guides/production" },
            { label: "Recipes", slug: "guide/guides/recipes" },
          ],
        },
        {
          label: "About",
          items: [
            { label: "Design principles", slug: "guide/about/principles" },
            { label: "What notio does not do", slug: "guide/about/scope" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Exports", slug: "reference/exports" },
            { label: "Error codes", slug: "reference/error-codes" },
            { label: "Route builder", slug: "reference/route-builder" },
            { label: "Durations and sizes", slug: "reference/durations-and-sizes" },
          ],
        },
        { label: "Examples", slug: "examples" },
      ],
    }),
  ],
});
