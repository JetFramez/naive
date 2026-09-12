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

    sidebar: [
      { text: "Guide", link: "/" },
      { text: "Reference", link: "/reference" },
    ],

    outline: { level: [2, 3] },
    docFooter: { prev: "Previous", next: "Next" },
    editLink: {
      pattern: "https://github.com/jetframez/notio/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    socialLinks: [{ icon: "github", link: "https://github.com/jetframez/notio" }],
    search: { provider: "local", options: { detailedView: true } },
  },
});
