<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'

const props = defineProps<{ name: string; input: unknown; output?: unknown; isError?: boolean; finished?: boolean }>()
const expanded = ref(false)
const inputText = computed(() => JSON.stringify(props.input, null, 2))
const outputText = computed(() => typeof props.output === 'string' ? props.output : JSON.stringify(props.output, null, 2))
const { t } = useI18n()
</script>

<template>
  <section class="tool-card" :class="{ error: isError }">
    <button class="tool-heading" type="button" @click="expanded = !expanded">
      <ChevronRight :size="15" :class="{ expanded }" />
      <TriangleAlert v-if="isError" :size="15" /><CircleCheck v-else-if="finished" :size="15" /><LoaderCircle v-else :size="15" class="spin" />
      <strong>{{ name }}</strong><span>{{ finished ? (isError ? t('toolFailed') : t('toolCompleted')) : t('toolRunning') }}</span>
    </button>
    <div v-if="expanded" class="details"><h4>{{ t('input') }}</h4><pre>{{ inputText }}</pre><template v-if="finished"><h4>{{ t('output') }}</h4><pre>{{ outputText }}</pre></template></div>
  </section>
</template>

<style scoped>
.tool-card { margin: 8px 40px; overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-subtle); }.tool-card.error { border-color: var(--danger-border); }.tool-heading { display: flex; width: 100%; align-items: center; gap: 8px; padding: 10px 12px; border: 0; background: none; cursor: pointer; text-align: left; }.tool-heading strong { font-size: 12px; }.tool-heading span { margin-left: auto; color: var(--text-muted); font-size: 11px; }.expanded { transform: rotate(90deg); }.spin { animation: spin 1s linear infinite; color: var(--accent); }@keyframes spin { to { transform: rotate(360deg); } }.details { padding: 0 12px 12px; }.details h4 { margin: 8px 0 5px; color: var(--text-muted); font-size: 10px; text-transform: uppercase; }.details pre { max-height: 280px; overflow: auto; margin: 0; white-space: pre-wrap; color: var(--text-secondary); font: 11px/1.55 var(--font-mono); }
</style>
