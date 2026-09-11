<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { AlertTriangle } from 'lucide-vue-next'
import type { TaskDto } from '../../domain/models'
import type { TaskEvent } from '../../domain/events'
import { errorMessage, ipc } from '../../services/ipc'
import { useI18n } from '../../services/i18n'
import MessageBubble from './MessageBubble.vue'
import ToolCard from './ToolCard.vue'
import ComposerBox from './ComposerBox.vue'
import PermissionCard from '../permissions/PermissionCard.vue'
import QuestionCard from '../permissions/QuestionCard.vue'
import InlineError from '../common/InlineError.vue'

type RenderItem =
  | { type: 'message'; key: string; role: 'user' | 'assistant'; text: string; streaming?: boolean }
  | { type: 'tool'; key: string; name: string; input: unknown; output?: unknown; isError?: boolean; finished: boolean }
  | { type: 'permission'; key: string; requestId: string; toolName: string; input: unknown; suggestions: unknown[] }
  | { type: 'question'; key: string; requestId: string; questions: Extract<TaskEvent, { kind: 'question_requested' }>['data']['questions'] }
  | { type: 'error'; key: string; message: string }
  | { type: 'conflict'; key: string; count: number }
  | { type: 'result'; key: string; cost: number | null; turns: number | null }

const props = defineProps<{ task: TaskDto; events: TaskEvent[]; cliReady: boolean }>()
const emit = defineEmits<{ send: [text: string]; stop: [] }>()
const error = ref('')
const scroll = ref<HTMLElement | null>(null)
const active = computed(() => ['starting', 'running', 'awaiting_permission', 'stopping'].includes(props.task.status))
const { t } = useI18n()

const items = computed<RenderItem[]>(() => {
  const result: RenderItem[] = []
  const messages = new Map<string, Extract<RenderItem, { type: 'message' }>>()
  const currentAssistantByRun = new Map<string, Extract<RenderItem, { type: 'message' }>>()
  const tools = new Map<string, Extract<RenderItem, { type: 'tool' }>>()
  const resolved = new Set(props.events.filter((event) => event.kind === 'permission_resolved').map((event) => event.data.requestId))
  for (const event of props.events) {
    switch (event.kind) {
      case 'user_message': result.push({ type: 'message', key: `${event.runId}:${event.sequence}`, role: 'user', text: event.data.text }); break
      case 'assistant_delta': {
        let item = messages.get(event.data.messageId) ?? currentAssistantByRun.get(event.runId)
        if (!item || !item.streaming) {
          item = { type: 'message', key: `message:${event.runId}:${event.data.messageId}`, role: 'assistant', text: '', streaming: true }
          currentAssistantByRun.set(event.runId, item)
          result.push(item)
        }
        messages.set(event.data.messageId, item)
        item.text += event.data.text
        break
      }
      case 'assistant_message': {
        const item = messages.get(event.data.messageId) ?? currentAssistantByRun.get(event.runId)
        if (item) { item.text = event.data.markdown; item.streaming = false; messages.set(event.data.messageId, item) }
        else { const created: Extract<RenderItem, { type: 'message' }> = { type: 'message', key: `message:${event.runId}:${event.data.messageId}`, role: 'assistant', text: event.data.markdown }; messages.set(event.data.messageId, created); result.push(created) }
        currentAssistantByRun.delete(event.runId)
        break
      }
      case 'tool_started': { const item: Extract<RenderItem, { type: 'tool' }> = { type: 'tool', key: `tool:${event.data.toolUseId}`, name: event.data.toolName, input: event.data.input, finished: false }; tools.set(event.data.toolUseId, item); result.push(item); break }
      case 'tool_finished': { const item = tools.get(event.data.toolUseId); if (item) { item.output = event.data.output; item.isError = event.data.isError; item.finished = true } break }
      case 'permission_requested': if (!resolved.has(event.data.requestId)) result.push({ type: 'permission', key: `permission:${event.data.requestId}`, requestId: event.data.requestId, toolName: event.data.toolName, input: event.data.input, suggestions: event.data.suggestions }); break
      case 'question_requested': if (!resolved.has(event.data.requestId)) result.push({ type: 'question', key: `question:${event.data.requestId}`, requestId: event.data.requestId, questions: event.data.questions }); break
      case 'error': if (event.data.code !== 'api_retry') result.push({ type: 'error', key: `${event.runId}:${event.sequence}`, message: event.data.message }); break
      case 'workspace_conflict': result.push({ type: 'conflict', key: `${event.runId}:${event.sequence}`, count: event.data.activeTaskIds.length }); break
      case 'result': result.push({ type: 'result', key: `${event.runId}:${event.sequence}`, cost: event.data.costUsd, turns: event.data.turns }); break
    }
  }
  const lastAssistant = [...result].reverse().find((item) => item.type === 'message' && item.role === 'assistant')
  if (lastAssistant?.type === 'message') lastAssistant.streaming = active.value && props.task.status !== 'awaiting_permission'
  return result
})

async function resolve(requestId: string, value: { decision: 'allow_once' | 'allow_task' | 'deny'; updatedInput: unknown; permissionUpdate?: unknown }) {
  try { await ipc.resolvePermission(props.task.id, requestId, value.decision, value.updatedInput, value.permissionUpdate) }
  catch (cause) { error.value = errorMessage(cause) }
}

async function answer(requestId: string, updatedInput: unknown) { await resolve(requestId, { decision: 'allow_once', updatedInput }) }
async function denyQuestion(requestId: string) { await resolve(requestId, { decision: 'deny', updatedInput: {} }) }

watch(() => props.events.length, async () => { await nextTick(); if (scroll.value) scroll.value.scrollTop = scroll.value.scrollHeight })
</script>

<template>
  <section class="conversation-shell">
    <div ref="scroll" class="conversation" aria-live="polite">
      <div v-if="!items.length" class="conversation-empty"><span>✳</span><h2>{{ t('startTask') }}</h2><p>{{ t('startTaskHelp') }}</p></div>
      <div v-else class="timeline">
        <template v-for="item in items" :key="item.key">
          <MessageBubble v-if="item.type === 'message'" :role="item.role" :text="item.text" :streaming="item.streaming" />
          <ToolCard v-else-if="item.type === 'tool'" :name="item.name" :input="item.input" :output="item.output" :is-error="item.isError" :finished="item.finished" />
          <PermissionCard v-else-if="item.type === 'permission'" :tool-name="item.toolName" :input="item.input" :suggestions="item.suggestions" @resolve="resolve(item.requestId, $event)" />
          <QuestionCard v-else-if="item.type === 'question'" :questions="item.questions" @resolve="answer(item.requestId, $event)" @deny="denyQuestion(item.requestId)" />
          <div v-else-if="item.type === 'conflict'" class="conflict"><AlertTriangle :size="16" />{{ t('workspaceConflict', { count: item.count }) }}</div>
          <div v-else-if="item.type === 'error'" class="event-error">{{ item.message }}</div>
          <div v-else-if="item.type === 'result'" class="result">{{ t('turnComplete') }}<span v-if="item.turns"> · {{ t('turns', { count: item.turns }) }}</span><span v-if="item.cost !== null"> · ${{ item.cost.toFixed(4) }}</span></div>
        </template>
      </div>
    </div>
    <InlineError v-if="error" :message="error" @close="error = ''" />
    <ComposerBox :running="active" :disabled="!cliReady" @send="emit('send', $event)" @stop="emit('stop')" />
  </section>
</template>

<style scoped>
.conversation-shell { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }.conversation { min-height: 0; flex: 1; overflow: auto; scroll-padding-bottom: 120px; }.timeline { width: min(860px, calc(100% - 48px)); margin: 0 auto; padding: 26px 0 104px; }.conversation-empty { display: grid; height: 100%; place-content: center; justify-items: center; padding: 30px; text-align: center; color: var(--text-secondary); }.conversation-empty > span { color: var(--accent); font-size: 40px; }.conversation-empty h2 { margin: 12px 0 6px; color: var(--text-primary); }.conversation-empty p { max-width: 440px; margin: 0; line-height: 1.6; }.conflict,.event-error { display: flex; align-items: center; gap: 8px; margin: 10px 0; padding: 10px 12px; border-radius: var(--radius-sm); font-size: 12px; }.conflict { border: 1px solid var(--warning-border); background: var(--warning-soft); color: var(--text-warning); }.event-error { border: 1px solid var(--danger-border); background: var(--danger-soft); color: var(--text-danger); }.result { margin: 22px 0; color: var(--text-muted); font-size: 11px; text-align: center; }
@media (max-width: 720px) { .timeline { width: calc(100% - 28px); padding-top: 18px; } }
</style>
