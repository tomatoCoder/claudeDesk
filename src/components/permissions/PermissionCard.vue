<script setup lang="ts">
import { computed } from 'vue'
import { ShieldAlert } from 'lucide-vue-next'

const props = defineProps<{ toolName: string; input: unknown; suggestions: string[] }>()
const emit = defineEmits<{ resolve: [value: { decision: 'allow_once' | 'allow_task' | 'deny'; updatedInput: unknown; rule?: string }] }>()
const inputText = computed(() => JSON.stringify(props.input, null, 2))
const suggestedRule = computed(() => props.suggestions.find((rule) => rule.trim().length > 0))
</script>

<template>
  <section class="permission-card">
    <header><ShieldAlert :size="18" /><div><strong>Claude 请求执行 {{ toolName }}</strong><p>确认后才会继续当前任务。</p></div></header>
    <pre>{{ inputText }}</pre>
    <footer>
      <button class="danger-button" type="button" data-action="deny" @click="emit('resolve', { decision: 'deny', updatedInput: input })">拒绝</button>
      <button v-if="suggestedRule" class="secondary-button" type="button" data-action="allow-task" :title="suggestedRule" @click="emit('resolve', { decision: 'allow_task', updatedInput: input, rule: suggestedRule })">本任务内允许</button>
      <button class="primary-button" type="button" data-action="allow-once" @click="emit('resolve', { decision: 'allow_once', updatedInput: input })">允许一次</button>
    </footer>
  </section>
</template>

<style scoped>
.permission-card { margin: 14px 40px; padding: 14px; border: 1px solid rgba(214,158,46,.4); border-radius: var(--radius-md); background: rgba(214,158,46,.07); }.permission-card header { display: flex; gap: 10px; color: #efc979; }.permission-card header strong { color: var(--text-primary); }.permission-card p { margin: 4px 0 0; color: var(--text-secondary); font-size: 12px; }.permission-card pre { max-height: 240px; overflow: auto; margin: 12px 0; padding: 10px; border-radius: var(--radius-sm); background: rgba(0,0,0,.28); white-space: pre-wrap; color: var(--text-secondary); font: 11px/1.5 var(--font-mono); }.permission-card footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>
