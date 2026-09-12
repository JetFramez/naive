import { defineConfig } from "vitepress";

export default defineConfig({
  title: "notio",
  description: "A TypeScript web framework on Express 5.",
  cleanUrls: true,
  srcDir: ".",
  outDir: ".vitepress/dist",

  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/router" },
      { text: "GitHub", link: "https://github.com/jetframez/notio" },
    ],

    sidebar: [
      {
        text: "Core",
        items: [
          { text: "Router", link: "/guide/router" },
          { text: "Context", link: "/guide/ctx" },
          { text: "Errors", link: "/guide/errors" },
          { text: "Logging & ambient context", link: "/guide/logging" },
          { text: "Hooks", link: "/guide/hooks" },
          { text: "Config", link: "/guide/config" },
          { text: "createApp", link: "/guide/app" },
          { text: "Events", link: "/guide/events" },
          { text: "Cache", link: "/guide/cache" },
        ],
      },
      {
        text: "Modules",
        items: [
          { text: "Uploads", link: "/guide/upload" },
          { text: "Auth", link: "/guide/auth" },
          { text: "Rate limiting", link: "/guide/rate-limit" },
          { text: "OpenAPI", link: "/guide/openapi" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/jetframez/notio" }],

    search: { provider: "local" },
  },
});
