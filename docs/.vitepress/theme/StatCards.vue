<script setup lang="ts">
defineProps<{ items: { value: string; caption: string }[] }>();
</script>

<template>
  <div class="stat-grid">
    <div v-for="item in items" :key="item.value + item.caption" class="stat-card">
      <p class="stat-number">{{ item.value }}</p>
      <p class="stat-caption">{{ item.caption }}</p>
    </div>
  </div>
</template>
