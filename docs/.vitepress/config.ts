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
    ["meta", { name: "theme-color", content: "#14b8a6" }],
  ],

  themeConfig: {
    logo: "/logo.svg",

    nav: [
      { text: "Guide", link: "/" },
      { text: "Reference", link: "/reference" },
      { text: "GitHub", link: "https://github.com/jetframez/notio" },
    ],

    sidebar: {
      "/reference": [
        {
          text: "Core",
          items: [
            { text: "createApp", link: "/reference#createapp-options" },
            { text: "Router", link: "/reference#router" },
            { text: "Context", link: "/reference#context" },
            { text: "Middleware", link: "/reference#middleware" },
            { text: "Error codes", link: "/reference#error-codes" },
            { text: "Config", link: "/reference#config" },
            { text: "Logger", link: "/reference#logger" },
            { text: "Events", link: "/reference#events" },
            { text: "Cache", link: "/reference#cache" },
          ],
        },
        {
          text: "Modules",
          items: [
            { text: "Auth", link: "/reference#auth" },
            { text: "Uploads", link: "/reference#uploads" },
            { text: "Rate limiting", link: "/reference#rate-limiting" },
            { text: "OpenAPI", link: "/reference#openapi" },
          ],
        },
        {
          text: "Other",
          items: [{ text: "Durations and sizes", link: "/reference#durations-and-sizes" }],
        },
      ],
      "/": [
        {
          text: "Start",
          items: [
            { text: "Install", link: "/#install" },
            { text: "A first app", link: "/#a-first-app" },
          ],
        },
        {
          text: "Core",
          items: [
            { text: "createApp", link: "/#createapp" },
            { text: "Router", link: "/#router" },
            { text: "Context", link: "/#context" },
            { text: "Middleware", link: "/#middleware" },
            { text: "Responses", link: "/#responses" },
            { text: "Errors", link: "/#errors" },
            { text: "Hooks", link: "/#hooks" },
            { text: "Config", link: "/#config" },
            { text: "Logging", link: "/#logging-and-ambient-context" },
            { text: "Events", link: "/#events" },
            { text: "Cache", link: "/#cache" },
          ],
        },
        {
          text: "Modules",
          items: [
            { text: "Auth", link: "/#auth" },
            { text: "Uploads", link: "/#uploads" },
            { text: "Rate limiting", link: "/#rate-limiting" },
            { text: "OpenAPI", link: "/#openapi" },
          ],
        },
        {
          text: "Ship it",
          items: [{ text: "Testing and production", link: "/#testing-and-production" }],
        },
      ],
    },

    outline: false,
    docFooter: { prev: "Previous", next: "Next" },
    editLink: {
      pattern: "https://github.com/jetframez/notio/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    socialLinks: [{ icon: "github", link: "https://github.com/jetframez/notio" }],
    search: { provider: "local", options: { detailedView: true } },
  },
});
