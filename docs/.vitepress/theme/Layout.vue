<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import PageContent from "./PageContent.vue";

interface NavLink {
  id: string;
  label: string;
  mono?: boolean;
}
interface NavGroup {
  label: string;
  links: NavLink[];
}

const groups: NavGroup[] = [
  {
    label: "Start",
    links: [
      { id: "intro", label: "Introduction" },
      { id: "install", label: "Install" },
      { id: "first-route", label: "Your first route" },
    ],
  },
  {
    label: "Core",
    links: [
      { id: "createapp", label: "createApp", mono: true },
      { id: "router", label: "Router", mono: true },
      { id: "context", label: "Context", mono: true },
      { id: "middleware", label: "Middleware", mono: true },
      { id: "responses", label: "Responses", mono: true },
      { id: "errors", label: "Errors", mono: true },
      { id: "hooks", label: "Hooks", mono: true },
      { id: "config", label: "Config", mono: true },
      { id: "logging", label: "Logging", mono: true },
      { id: "events", label: "Events", mono: true },
      { id: "cache", label: "Cache", mono: true },
    ],
  },
  {
    label: "Modules",
    links: [
      { id: "auth", label: "Auth", mono: true },
      { id: "uploads", label: "Uploads", mono: true },
      { id: "rate-limiting", label: "Rate limiting", mono: true },
      { id: "openapi", label: "OpenAPI", mono: true },
    ],
  },
];

// One value, written only by the observer, read only by the sidebar —
// state + a class, not the imperative style-painting the design reference
// used as a prototyping shortcut.
const activeId = ref("intro");
let observer: IntersectionObserver | undefined;
const rootEl = ref<HTMLElement | null>(null);

onMounted(() => {
  const sections = Array.from(
    rootEl.value?.querySelectorAll<HTMLElement>("main section[id]") ?? [],
  );
  if (sections.length === 0) return;
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length > 0) activeId.value = visible[0].target.id;
    },
    { rootMargin: "-12% 0px -60% 0px", threshold: 0 },
  );
  for (const section of sections) observer.observe(section);
});

onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div ref="rootEl" class="page-shell">
    <div class="page-columns">
      <aside class="sidebar">
        <details class="sidebar-disclosure" open>
          <summary class="sidebar-brand">
            <span class="sidebar-brand-mark" />
            <span class="sidebar-brand-name">notio</span>
            <span class="sidebar-brand-version">v0.1.0</span>
            <span class="sidebar-disclosure-caret">▾</span>
          </summary>

          <div class="sidebar-groups">
            <div v-for="group in groups" :key="group.label">
              <p class="sidebar-group-label">{{ group.label }}</p>
              <nav class="sidebar-nav">
                <a
                  v-for="link in group.links"
                  :key="link.id"
                  :href="`#${link.id}`"
                  class="sidebar-link"
                  :class="{ 'is-mono': link.mono, 'is-active': activeId === link.id }"
                  :aria-current="activeId === link.id ? 'true' : undefined"
                >{{ link.label }}</a>
              </nav>
            </div>

            <p class="sidebar-note">
              Everything past <a href="#first-route">Your first route</a> is optional.
              <code>createApp</code> and <code>Router</code> are the two you'll use on every project.
            </p>
          </div>
        </details>
      </aside>

      <main class="content">
        <PageContent />
      </main>
    </div>
  </div>
</template>
