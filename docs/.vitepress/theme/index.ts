import type { Theme } from "vitepress";
import Layout from "./Layout.vue";
import "./custom.css";

// A fully custom theme, not an extension of DefaultTheme: the design has no
// top nav, no dark-mode toggle, no search box, and a sidebar with different
// behavior (in-page anchors with scroll-spy) than VitePress's own. Layout.vue
// owns the entire page; there is exactly one route.
export default {
  Layout,
} satisfies Theme;
