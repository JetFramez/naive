<script setup lang="ts">
defineProps<{ filename: string }>();
</script>

<template>
  <div class="window-card">
    <div class="window-card-titlebar">
      <span class="window-card-dot" />
      <span class="window-card-dot" />
      <span class="window-card-dot" />
      <span class="window-card-filename">{{ filename }}</span>
    </div>
    <pre><slot /></pre>
  </div>
</template>
