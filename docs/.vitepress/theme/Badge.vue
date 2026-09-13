<script setup lang="ts">
withDefaults(defineProps<{ type?: "neutral" | "green" | "dark" }>(), { type: "neutral" });
</script>

<template>
  <span class="badge" :class="{ 'is-green': type === 'green', 'is-dark': type === 'dark' }">
    <slot />
  </span>
</template>
