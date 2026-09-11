<script setup lang="ts">
import { computed } from 'vue'
import { ShieldAlert } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'

const props = defineProps<{ toolName: string; input: unknown; suggestions: unknown[] }>()
const emit = defineEmits<{ resolve: [value: { decision: 'allow_once' | 'allow_task' | 'deny'; updatedInput: unknown; permissionUpdate?: unknown }] }>()
const inputText = computed(() => JSON.stringify(props.input, null, 2))
const suggestedUpdate = computed(() => props.suggestions.find((update) => update !== null && update !== undefined))
const suggestedTitle = computed(() => suggestedUpdate.value ? JSON.stringify(suggestedUpdate.value) : '')
const { t } = useI18n()
</script>

<template>
  <section class="permission-card">
    <header><ShieldAlert :size="18" /><div><strong>{{ t('permissionRequest', { tool: toolName }) }}</strong><p>{{ t('permissionHelp') }}</p></div></header>
    <pre>{{ inputText }}</pre>
    <footer>
      <button class="danger-button" type="button" data-action="deny" @click="emit('resolve', { decision: 'deny', updatedInput: input })">{{ t('deny') }}</button>
      <button v-if="suggestedUpdate" class="secondary-button" type="button" data-action="allow-task" :title="suggestedTitle" @click="emit('resolve', { decision: 'allow_task', updatedInput: input, permissionUpdate: suggestedUpdate })">{{ t('allowTask') }}</button>
      <button class="primary-button" type="button" data-action="allow-once" @click="emit('resolve', { decision: 'allow_once', updatedInput: input })">{{ t('allowOnce') }}</button>
    </footer>
  </section>
</template>

<style scoped>
.permission-card { margin: 14px 40px; padding: 14px; border: 1px solid var(--warning-border); border-radius: var(--radius-md); background: var(--warning-soft); }.permission-card header { display: flex; gap: 10px; color: var(--text-warning); }.permission-card header strong { color: var(--text-primary); }.permission-card p { margin: 4px 0 0; color: var(--text-secondary); font-size: 12px; }.permission-card pre { max-height: 240px; overflow: auto; margin: 12px 0; padding: 10px; border-radius: var(--radius-sm); background: var(--surface-inset); white-space: pre-wrap; color: var(--text-secondary); font: 11px/1.5 var(--font-mono); }.permission-card footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>
