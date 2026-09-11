<script setup lang="ts">
import { RefreshCw, X } from 'lucide-vue-next'
import type { WorkspaceDiff } from '../../domain/models'
import { useI18n } from '../../services/i18n'
import FileStatusList from './FileStatusList.vue'
import PatchView from './PatchView.vue'
defineProps<{ diff: WorkspaceDiff | null; loading: boolean }>()
defineEmits<{ close: []; refresh: [] }>()
const { t } = useI18n()
</script>

<template>
  <aside class="diff-panel"><header><div><strong>Workspace Diff</strong><small v-if="diff?.branch">{{ diff.branch }}</small></div><button class="icon-button" type="button" :title="t('refresh')" @click="$emit('refresh')"><RefreshCw :size="15" :class="{ spin: loading }" /></button><button class="icon-button" type="button" :title="t('close')" @click="$emit('close')"><X :size="17" /></button></header><div v-if="!diff" class="loading">{{ loading ? t('reading') : t('noData') }}</div><div v-else-if="!diff.isRepository" class="loading">{{ t('notGitRepository') }}</div><template v-else><FileStatusList :files="diff.files" /><PatchView :patch="diff.patch || t('noChanges')" /></template></aside>
</template>

<style scoped>
.diff-panel { display: flex; width: 390px; min-width: 300px; min-height: 0; flex-direction: column; border-left: 1px solid var(--border-subtle); background: var(--surface-panel); }.diff-panel header { display: flex; align-items: center; gap: 4px; height: 58px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--border-subtle); }.diff-panel header div { min-width: 0; flex: 1; }.diff-panel header strong,.diff-panel header small { display: block; }.diff-panel header small { margin-top: 2px; color: var(--text-muted); font-size: 10px; }.loading { display: grid; flex: 1; place-items: center; color: var(--text-muted); }.spin { animation: spin 1s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }
</style>
