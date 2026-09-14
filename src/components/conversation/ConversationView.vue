<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertTriangle } from 'lucide-vue-next'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { QueuedTurnDto, SlashCommandCatalogDto, SlashCommandsChanged, TaskDto } from '../../domain/models'
import type { TaskEvent } from '../../domain/events'
import { errorMessage, ipc } from '../../services/ipc'
import { useI18n } from '../../services/i18n'
import { invalidateSlashCommandCatalog, loadSlashCommandCatalog } from '../../services/slashCommands'
import MessageBubble from './MessageBubble.vue'
import ToolCard from './ToolCard.vue'
import ComposerBox from './ComposerBox.vue'
import SlashCommandDialog, { type SlashDialogKind } from './SlashCommandDialog.vue'
import PermissionCard from '../permissions/PermissionCard.vue'
import QuestionCard from '../permissions/QuestionCard.vue'
import InlineError from '../common/InlineError.vue'

type RenderItem =
  | { type: 'message'; key: string; role: 'user' | 'assistant'; text: string; streaming?: boolean; createdAt?: string; turnStartedAt?: number; turnDurationMs?: number | null }
  | { type: 'tool'; key: string; name: string; input: unknown; output?: unknown; isError?: boolean; finished: boolean }
  | { type: 'permission'; key: string; requestId: string; toolName: string; input: unknown; suggestions: unknown[] }
  | { type: 'question'; key: string; requestId: string; questions: Extract<TaskEvent, { kind: 'question_requested' }>['data']['questions'] }
  | { type: 'cli'; key: string; content: string }
  | { type: 'error'; key: string; message: string }
  | { type: 'conflict'; key: string; count: number }
  | { type: 'result'; key: string; cost: number | null; turns: number | null }
  | { type: 'thinking'; key: string }

const props = defineProps<{
  task: TaskDto
  events: TaskEvent[]
  cliReady: boolean
  queuedTurns?: QueuedTurnDto[]
  submit?: (text: string) => Promise<void>
  adjust?: (id: string) => Promise<void>
  sendNow?: (id: string) => Promise<void>
  remove?: (id: string) => Promise<void>
  update?: (id: string, text: string) => Promise<void>
}>()
const emit = defineEmits<{ stop: []; 'open-settings': []; 'task-updated': [task: TaskDto] }>()
const error = ref('')
const scroll = ref<HTMLElement | null>(null)
const active = computed(() => ['starting', 'running', 'awaiting_permission', 'stopping'].includes(props.task.status))
const { t, language } = useI18n()

// 对话时间分隔线：今天只显示时刻，跨天补日期，按界面语言格式化。
const turnTimeFormatter = computed(() => {
  const locale = language.value === 'en-US' ? 'en-US' : 'zh-CN'
  return {
    time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
    dateTime: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    fullDate: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  }
})

function formatTurnTime(iso: string) {
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return turnTimeFormatter.value.time.format(date)
  if (date.getFullYear() === now.getFullYear()) return turnTimeFormatter.value.dateTime.format(date)
  return turnTimeFormatter.value.fullDate.format(date)
}
const unavailable = async () => { throw new Error('消息操作不可用') }

const dialog = ref<SlashDialogKind | null>(null)
const composer = ref<InstanceType<typeof ComposerBox> | null>(null)

async function submitTurn(value: string): Promise<boolean | void> {
  const bare = value.trim()
  if (bare === '/config') { emit('open-settings'); return false }
  if (bare === '/model' || bare === '/permissions') { dialog.value = bare.slice(1) as SlashDialogKind; return false }
  await (props.submit ?? unavailable)(value)
}

function closeDialog() {
  dialog.value = null
  composer.value?.focus()
}

async function insertDraft(value: string) {
  await nextTick()
  await composer.value?.insert(value)
}

const catalog = ref<SlashCommandCatalogDto | null>(null)
const catalogLoading = ref(false)
const catalogError = ref('')
let unlistenCommands: UnlistenFn | undefined
// 递增令牌：项目切换或 slash-commands-changed 会让在途请求作废，防止晚到的旧目录覆盖新数据。
let catalogRequestId = 0

async function reloadCatalog(force = false) {
  const projectId = props.task.projectId
  const requestId = ++catalogRequestId
  catalogLoading.value = true
  catalogError.value = ''
  try {
    const loaded = await loadSlashCommandCatalog(projectId, force)
    if (requestId === catalogRequestId && projectId === props.task.projectId) catalog.value = loaded
  } catch (cause) {
    if (requestId === catalogRequestId && projectId === props.task.projectId) catalogError.value = errorMessage(cause)
  } finally {
    if (requestId === catalogRequestId) catalogLoading.value = false
  }
}

watch(() => props.task.projectId, () => {
  catalog.value = null
  catalogError.value = ''
  void reloadCatalog()
}, { immediate: true })

onMounted(async () => {
  unlistenCommands = await listen<SlashCommandsChanged>('slash-commands-changed', ({ payload }) => {
    invalidateSlashCommandCatalog(payload.projectId)
    if (payload.projectId === props.task.projectId) {
      catalogRequestId++
      catalog.value = payload.catalog
      catalogLoading.value = false
      catalogError.value = ''
    }
  }).catch(() => undefined)
})

onBeforeUnmount(() => unlistenCommands?.())

const items = computed<RenderItem[]>(() => {
  const result: RenderItem[] = []
  const messages = new Map<string, Extract<RenderItem, { type: 'message' }>>()
  const currentAssistantByRun = new Map<string, Extract<RenderItem, { type: 'message' }>>()
  const tools = new Map<string, Extract<RenderItem, { type: 'tool' }>>()
  const resolved = new Set(props.events.filter((event) => event.kind === 'permission_resolved').map((event) => event.data.requestId))
  // 每轮起止时间：runId 首个事件作为轮次起点，result 事件作为终点（用于总耗时）。
  const runStart = new Map<string, number>()
  const runDuration = new Map<string, number>()
  // 「正在思考」占位：最新一轮发出用户消息后、助手尚未产生任何输出（文本或工具）之前显示。
  let lastUserRun: string | null = null
  const assistantRuns = new Set<string>()
  for (const event of props.events) {
    if (!runStart.has(event.runId)) runStart.set(event.runId, Date.parse(event.createdAt))
    if (event.kind === 'result' && runStart.has(event.runId)) runDuration.set(event.runId, Date.parse(event.createdAt) - (runStart.get(event.runId) ?? 0))
  }
  for (const event of props.events) {
    switch (event.kind) {
      case 'user_message': result.push({ type: 'message', key: `${event.runId}:${event.sequence}`, role: 'user', text: event.data.text, createdAt: event.createdAt }); lastUserRun = event.runId; break
      case 'assistant_delta': {
        assistantRuns.add(event.runId)
        let item = messages.get(event.data.messageId) ?? currentAssistantByRun.get(event.runId)
        if (!item || !item.streaming) {
          item = { type: 'message', key: `message:${event.runId}:${event.data.messageId}`, role: 'assistant', text: '', streaming: true, turnStartedAt: runStart.get(event.runId), turnDurationMs: runDuration.get(event.runId) ?? null }
          currentAssistantByRun.set(event.runId, item)
          result.push(item)
        }
        messages.set(event.data.messageId, item)
        item.text += event.data.text
        break
      }
      case 'assistant_message': {
        assistantRuns.add(event.runId)
        const item = messages.get(event.data.messageId) ?? currentAssistantByRun.get(event.runId)
        if (item) { item.text = event.data.markdown; item.streaming = false; messages.set(event.data.messageId, item) }
        else { const created: Extract<RenderItem, { type: 'message' }> = { type: 'message', key: `message:${event.runId}:${event.data.messageId}`, role: 'assistant', text: event.data.markdown, turnStartedAt: runStart.get(event.runId), turnDurationMs: runDuration.get(event.runId) ?? null }; messages.set(event.data.messageId, created); result.push(created) }
        currentAssistantByRun.delete(event.runId)
        break
      }
      case 'tool_started': { assistantRuns.add(event.runId); const item: Extract<RenderItem, { type: 'tool' }> = { type: 'tool', key: `tool:${event.data.toolUseId}`, name: event.data.toolName, input: event.data.input, finished: false }; tools.set(event.data.toolUseId, item); result.push(item); break }
      case 'tool_finished': { const item = tools.get(event.data.toolUseId); if (item) { item.output = event.data.output; item.isError = event.data.isError; item.finished = true } break }
      case 'permission_requested': if (!resolved.has(event.data.requestId)) result.push({ type: 'permission', key: `permission:${event.data.requestId}`, requestId: event.data.requestId, toolName: event.data.toolName, input: event.data.input, suggestions: event.data.suggestions }); break
      case 'question_requested': if (!resolved.has(event.data.requestId)) result.push({ type: 'question', key: `question:${event.data.requestId}`, requestId: event.data.requestId, questions: event.data.questions }); break
      case 'local_command_output': result.push({ type: 'cli', key: `${event.runId}:${event.sequence}`, content: event.data.content }); break
      case 'error': if (event.data.code !== 'api_retry') result.push({ type: 'error', key: `${event.runId}:${event.sequence}`, message: event.data.message }); break
      case 'workspace_conflict': result.push({ type: 'conflict', key: `${event.runId}:${event.sequence}`, count: event.data.activeTaskIds.length }); break
      case 'result': result.push({ type: 'result', key: `${event.runId}:${event.sequence}`, cost: event.data.costUsd, turns: event.data.turns }); break
    }
  }
  // 最新一轮已有用户消息、任务运行中、本轮尚无任何助手输出 → 显示「正在思考…」占位。
  const awaitingReply = active.value && props.task.status !== 'awaiting_permission' && lastUserRun !== null && !assistantRuns.has(lastUserRun)
  if (awaitingReply && lastUserRun !== null) result.push({ type: 'thinking', key: `thinking:${lastUserRun}` })
  const lastAssistant = [...result].reverse().find((item) => item.type === 'message' && item.role === 'assistant')
  // 等待首段回复期间由「正在思考…」占位负责提示，旧消息不再显示流式光标。
  if (lastAssistant?.type === 'message') lastAssistant.streaming = active.value && !awaitingReply && props.task.status !== 'awaiting_permission'
  return result
})

async function resolve(requestId: string, value: { decision: 'allow_once' | 'allow_task' | 'deny'; updatedInput: unknown; permissionUpdate?: unknown }) {
  try { await ipc.resolvePermission(props.task.id, requestId, value.decision, value.updatedInput, value.permissionUpdate) }
  catch (cause) { error.value = errorMessage(cause) }
}

async function answer(requestId: string, updatedInput: unknown) { await resolve(requestId, { decision: 'allow_once', updatedInput }) }
async function denyQuestion(requestId: string) { await resolve(requestId, { decision: 'deny', updatedInput: {} }) }

watch(() => props.events.length, async () => { await nextTick(); if (scroll.value) scroll.value.scrollTop = scroll.value.scrollHeight })

defineExpose({ insertDraft })
</script>

<template>
  <section class="conversation-shell">
    <div ref="scroll" class="conversation" aria-live="polite">
      <div v-if="!items.length" class="conversation-empty"><span>✳</span><h2>{{ t('startTask') }}</h2><p>{{ t('startTaskHelp') }}</p></div>
      <div v-else class="timeline">
        <template v-for="item in items" :key="item.key">
          <div v-if="item.type === 'message' && item.role === 'user' && item.createdAt" class="turn-time">{{ formatTurnTime(item.createdAt) }}</div>
          <MessageBubble v-if="item.type === 'message'" :role="item.role" :text="item.text" :streaming="item.streaming" :turn-started-at="item.turnStartedAt" :turn-duration-ms="item.turnDurationMs" />
          <ToolCard v-else-if="item.type === 'tool'" :name="item.name" :input="item.input" :output="item.output" :is-error="item.isError" :finished="item.finished" />
          <div v-else-if="item.type === 'cli'" class="cli-output"><span class="cli-badge">{{ t('cliOutputLabel') }}</span><pre>{{ item.content }}</pre></div>
          <PermissionCard v-else-if="item.type === 'permission'" :tool-name="item.toolName" :input="item.input" :suggestions="item.suggestions" @resolve="resolve(item.requestId, $event)" />
          <QuestionCard v-else-if="item.type === 'question'" :questions="item.questions" @resolve="answer(item.requestId, $event)" @deny="denyQuestion(item.requestId)" />
          <div v-else-if="item.type === 'conflict'" class="conflict"><AlertTriangle :size="16" />{{ t('workspaceConflict', { count: item.count }) }}</div>
          <div v-else-if="item.type === 'error'" class="event-error">{{ item.message }}</div>
          <div v-else-if="item.type === 'result'" class="result">{{ t('turnComplete') }}<span v-if="item.turns"> · {{ t('turns', { count: item.turns }) }}</span><span v-if="item.cost !== null"> · ${{ item.cost.toFixed(4) }}</span></div>
          <div v-else-if="item.type === 'thinking'" class="thinking">{{ t('thinking') }}</div>
        </template>
      </div>
    </div>
    <SlashCommandDialog v-if="dialog" :kind="dialog" :task="task" :models="catalog?.models ?? []" @updated="(value) => emit('task-updated', value)" @close="closeDialog" />
    <InlineError v-if="error" :message="error" @close="error = ''" />
    <ComposerBox ref="composer" :status="task.status" :queued-turns="queuedTurns ?? []" :disabled="!cliReady" :submit="submitTurn" :adjust="adjust ?? unavailable" :send-now="sendNow ?? unavailable" :remove="remove ?? unavailable" :update="update ?? unavailable" :commands="catalog?.commands ?? []" :commands-loading="catalogLoading" :commands-error="catalogError" @retry-commands="reloadCatalog(true)" @stop="emit('stop')" />
  </section>
</template>

<style scoped>
.conversation-shell { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }.conversation { min-height: 0; flex: 1; overflow: auto; scroll-padding-bottom: 120px; }.timeline { width: min(860px, calc(100% - 48px)); margin: 0 auto; padding: 26px 0 104px; }.turn-time { margin: 20px 0 2px; color: var(--text-muted); font-size: 10px; text-align: center; user-select: none; }.timeline .turn-time:first-child { margin-top: 0; }.conversation-empty { display: grid; height: 100%; place-content: center; justify-items: center; padding: 30px; text-align: center; color: var(--text-secondary); }.conversation-empty > span { color: var(--accent); font-size: 40px; }.conversation-empty h2 { margin: 12px 0 6px; color: var(--text-primary); }.conversation-empty p { max-width: 440px; margin: 0; line-height: 1.6; }.conflict,.event-error { display: flex; align-items: center; gap: 8px; margin: 10px 0; padding: 10px 12px; border-radius: var(--radius-sm); font-size: 12px; }.conflict { border: 1px solid var(--warning-border); background: var(--warning-soft); color: var(--text-warning); }.event-error { border: 1px solid var(--danger-border); background: var(--danger-soft); color: var(--text-danger); }.result { margin: 22px 0; color: var(--text-muted); font-size: 11px; text-align: center; }
.thinking { margin: 10px 0; color: var(--text-muted); font-size: 13px; animation: thinking-pulse 1.2s ease-in-out infinite; }@keyframes thinking-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
@media (prefers-reduced-motion: reduce) { .thinking { animation: none; } }
.cli-output { display: flex; gap: 10px; margin: 10px 0; padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-header); }.cli-badge { flex: none; height: fit-content; padding: 2px 6px; border-radius: 5px; background: var(--accent-soft); color: var(--accent); font-size: 10px; font-weight: 700; }.cli-output pre { min-width: 0; flex: 1; margin: 0; overflow: auto; color: var(--text-secondary); font: 11px/1.6 var(--font-mono); white-space: pre-wrap; }
@media (max-width: 720px) { .timeline { width: calc(100% - 28px); padding-top: 18px; } }
</style>
