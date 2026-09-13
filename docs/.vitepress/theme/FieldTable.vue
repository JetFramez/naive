<script setup lang="ts">
defineProps<{ rows: { name: string; desc: string }[] }>();
</script>

<template>
  <div class="field-table">
    <div v-for="row in rows" :key="row.name" class="field-row">
      <span class="field-name">{{ row.name }}</span>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <span class="field-desc" v-html="row.desc" />
    </div>
  </div>
</template>
