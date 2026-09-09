<script setup lang="ts">
defineProps<{ title: string; description: string; action?: string }>()
defineEmits<{ action: [] }>()
</script>

<template>
  <div class="empty-state">
    <span class="mark" aria-hidden="true">✳</span><h2>{{ title }}</h2><p>{{ description }}</p>
    <button v-if="action" class="primary-button" type="button" @click="$emit('action')">{{ action }}</button>
  </div>
</template>

<style scoped>
.empty-state { max-width: 440px; padding: 32px; text-align: center; color: var(--text-secondary); }
.mark { color: var(--accent); font-size: 45px; }.empty-state h2 { margin: 14px 0 7px; color: var(--text-primary); }.empty-state p { margin: 0 0 22px; line-height: 1.6; }
</style>
