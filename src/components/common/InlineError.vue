<script setup lang="ts">
import { useI18n } from '../../services/i18n'

defineProps<{ message: string }>()
defineEmits<{ close: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="inline-error" role="alert"><span>{{ message }}</span><button type="button" :aria-label="t('close')" @click="$emit('close')">×</button></div>
</template>

<style scoped>
.inline-error { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin: 12px; padding: 10px 12px; border: 1px solid var(--danger-border); border-radius: var(--radius-sm); background: var(--danger-soft); color: var(--text-danger); }
button { border: 0; background: none; color: inherit; cursor: pointer; }
</style>
