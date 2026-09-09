<script setup lang="ts">
defineProps<{ message: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <div class="inline-error" role="alert"><span>{{ message }}</span><button type="button" aria-label="关闭" @click="$emit('close')">×</button></div>
</template>

<style scoped>
.inline-error { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin: 12px; padding: 10px 12px; border: 1px solid rgba(207,93,93,.35); border-radius: var(--radius-sm); background: rgba(207,93,93,.1); color: #efb0b0; }
button { border: 0; background: none; color: inherit; cursor: pointer; }
</style>
