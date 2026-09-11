<script setup lang="ts">
import type { GitFileStatus } from '../../domain/models'
import { useI18n } from '../../services/i18n'
defineProps<{ files: GitFileStatus[] }>()
const { t } = useI18n()
</script>

<template><div class="files"><div v-for="file in files" :key="`${file.staged}:${file.path}`" class="file"><b>{{ file.status || 'M' }}</b><span :title="file.path">{{ file.path }}</span><em v-if="file.staged">{{ t('staged') }}</em></div><p v-if="!files.length">{{ t('cleanWorkspace') }}</p></div></template>

<style scoped>
.files { padding: 7px; border-bottom: 1px solid var(--border-subtle); }.file { display: grid; grid-template-columns: 24px minmax(0,1fr) auto; gap: 6px; align-items: center; padding: 6px; border-radius: 5px; font-size: 11px; }.file:hover { background: var(--surface-hover); }.file b { color: var(--accent); font-family: var(--font-mono); }.file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.file em { color: var(--success); font-size: 9px; font-style: normal; }.files p { padding: 12px; color: var(--text-muted); text-align: center; }
</style>
