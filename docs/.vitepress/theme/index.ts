import DefaultTheme from "vitepress/theme";
import "./custom.css";

/**
 * Highlights the sidebar link for whichever section heading is currently
 * near the top of the viewport — the left-nav sits in place of the
 * default right-hand "on this page" outline (disabled in config.ts), so
 * this is what makes the active section visible while scrolling.
 */
function setupScrollSpy(): (() => void) | undefined {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(".VPSidebar a.VPLink[href*='#']"),
  );
  const headingToLink = new Map<Element, HTMLAnchorElement>();
  for (const link of links) {
    const hash = link.getAttribute("href")?.split("#")[1];
    const heading = hash ? document.getElementById(hash) : null;
    if (heading) headingToLink.set(heading, link);
  }
  if (headingToLink.size === 0) return undefined;

  let current: HTMLAnchorElement | null = null;
  const setActive = (link: HTMLAnchorElement | null) => {
    if (link === current) return;
    current?.parentElement?.classList.remove("is-current-anchor");
    link?.parentElement?.classList.add("is-current-anchor");
    current = link;
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort(
          (a, b) => a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top,
        );
      if (visible.length > 0) setActive(headingToLink.get(visible[0].target) ?? null);
    },
    { rootMargin: "0px 0px -70% 0px", threshold: 0 },
  );
  for (const heading of headingToLink.keys()) observer.observe(heading);
  return () => observer.disconnect();
}

export default {
  ...DefaultTheme,
  enhanceApp({ router }) {
    if (typeof window === "undefined") return;
    let cleanup: (() => void) | undefined;
    const run = () => {
      cleanup?.();
      cleanup = setupScrollSpy();
    };
    router.onAfterRouteChange = () => requestAnimationFrame(run);
    if (document.readyState === "complete") requestAnimationFrame(run);
    else window.addEventListener("load", () => requestAnimationFrame(run), { once: true });
  },
};
