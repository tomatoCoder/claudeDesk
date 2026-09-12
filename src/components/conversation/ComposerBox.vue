<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { ArrowUp, Square } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'
import { ipc, isDesktop } from '../../services/ipc'
import type { QueuedTurnDto } from '../../domain/models'
import type { TaskStatus } from '../../domain/events'
import QueuedTurnList from './QueuedTurnList.vue'

const props = defineProps<{
  disabled?: boolean
  status: TaskStatus
  queuedTurns: QueuedTurnDto[]
  submit: (text: string) => Promise<void>
  adjust: (id: string) => Promise<void>
  sendNow: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  update: (id: string, text: string) => Promise<void>
}>()
const emit = defineEmits<{ stop: [] }>()
const text = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)
const dragActive = ref(false)
const submitting = ref(false)
const busyIds = ref<string[]>([])
const { t } = useI18n()
let lastDropKey = ''
let lastDropAt = 0

async function send() {
  const value = text.value.trim()
  if (!value || props.disabled || submitting.value) return
  submitting.value = true
  try {
    await props.submit(value)
    text.value = ''
  } catch {
    // App 层已展示 IPC 错误；保留输入内容供用户修正后重试。
  } finally { submitting.value = false }
}

function keydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing) return
  event.preventDefault()
  if (event.metaKey || event.ctrlKey) insertNewline()
  else send()
}

function insertNewline() {
  const el = textarea.value
  if (!el) return
  const start = el.selectionStart ?? text.value.length
  const end = el.selectionEnd ?? start
  text.value = `${text.value.slice(0, start)}\n${text.value.slice(end)}`
  void nextTick(() => {
    el.focus()
    el.setSelectionRange(start + 1, start + 1)
  })
}

async function appendPaths(paths: string[]) {
  if (props.disabled) return
  const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
  if (!unique.length) return
  const now = Date.now()
  const key = unique.join('\0')
  if (key === lastDropKey && now - lastDropAt < 500) return
  lastDropKey = key
  lastDropAt = now
  const prefix = text.value && !text.value.endsWith('\n') ? '\n' : ''
  text.value += `${prefix}${unique.join('\n')}\n`
  await nextTick()
  textarea.value?.focus()
  textarea.value?.setSelectionRange(text.value.length, text.value.length)
}

async function queueAction(id: string, action: (id: string) => Promise<void>) {
  if (busyIds.value.includes(id)) return
  busyIds.value = [...busyIds.value, id]
  try { await action(id) }
  catch {
    // App 层统一显示操作错误，避免模板事件留下未处理的 Promise。
  }
  finally { busyIds.value = busyIds.value.filter((item) => item !== id) }
}

function fileUriToPath(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return null
    const pathname = decodeURIComponent(url.pathname)
    return /^\/[A-Za-z]:[\\/]/.test(pathname) ? pathname.slice(1) : pathname
  } catch {
    return null
  }
}

function browserDropPaths(dataTransfer: DataTransfer) {
  const filePaths = [...dataTransfer.files]
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => !!path)
  const uriPaths = dataTransfer.getData('text/uri-list')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map(fileUriToPath)
    .filter((path): path is string => !!path)
  const plainPaths = dataTransfer.getData('text/plain')
    .split(/\r?\n/)
    .map((line) => fileUriToPath(line) ?? line.trim())
    .filter((line) => line.startsWith('/') || /^[A-Za-z]:[\\/]/.test(line) || line.startsWith('\\\\'))
  return [...filePaths, ...uriPaths, ...plainPaths]
}

async function handleBrowserDrop(event: DragEvent) {
  dragActive.value = false
  if (!event.dataTransfer) return
  const paths = browserDropPaths(event.dataTransfer)
  if (isDesktop()) {
    try {
      for (const path of await ipc.readDragFilePaths()) if (!paths.includes(path)) paths.push(path)
    } catch {
      // Drag pasteboard unavailable — keep whatever the browser exposed.
    }
  }
  await appendPaths(paths)
}

function handleBrowserDragLeave(event: DragEvent) {
  const current = event.currentTarget as HTMLElement
  if (!event.relatedTarget || !current.contains(event.relatedTarget as Node)) dragActive.value = false
}
</script>

<template>
  <div class="composer" :class="{ 'drag-active': dragActive }" @dragenter.prevent="dragActive = !disabled" @dragover.prevent="dragActive = !disabled" @dragleave="handleBrowserDragLeave" @drop.prevent="handleBrowserDrop">
    <div v-if="dragActive" class="drop-hint">{{ t('dropFilesHere') }}</div>
    <QueuedTurnList :turns="queuedTurns" :status="status" :busy-ids="busyIds" @adjust="queueAction($event, adjust)" @send-now="queueAction($event, sendNow)" @remove="queueAction($event, remove)" @update="(id, value) => queueAction(id, () => update(id, value))" />
    <textarea ref="textarea" v-model="text" rows="3" :disabled="disabled" placeholder="随心输入" :aria-label="t('sendMessage')" @keydown="keydown" />
    <div class="composer-footer"><span>{{ t('sendShortcut') }}</span><button v-if="['starting', 'running', 'awaiting_permission', 'stopping'].includes(status)" class="stop" type="button" :title="t('stopTask')" @click="emit('stop')"><Square :size="14" /></button><button data-testid="composer-submit" class="send" type="button" :disabled="disabled || submitting || !text.trim()" :title="t('send')" @click="send"><ArrowUp :size="17" /></button></div>
  </div>
</template>

<style scoped>
.composer { position: relative; width: min(860px, calc(100% - 48px)); margin: 0 auto 17px; overflow: hidden; border: 1px solid var(--border-strong); border-radius: 18px; background: var(--surface-composer); box-shadow: var(--shadow-composer); transition: border-color .16s ease, box-shadow .16s ease; }.composer:focus-within { border-color: var(--accent-border); box-shadow: var(--shadow-composer-focus); }.composer.drag-active { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow-composer-focus); }.drop-hint { position: absolute; z-index: 2; inset: 0; display: grid; place-items: center; background: var(--surface-composer); color: var(--accent); font-size: 13px; font-weight: 650; pointer-events: none; }.composer textarea { display: block; width: 100%; min-height: 74px; max-height: 220px; resize: none; padding: 16px 17px 5px; border: 0; outline: 0; background: transparent; color: var(--text-primary); line-height: 1.55; }.composer textarea::placeholder { color: var(--text-muted); }.composer-footer { display: flex; min-height: 42px; align-items: center; justify-content: flex-end; gap: 10px; padding: 5px 9px 8px 16px; }.composer-footer span { margin-right: auto; color: var(--text-muted); font-size: 10px; }.send,.stop { display: grid; width: 31px; height: 31px; place-items: center; border: 0; border-radius: 10px; cursor: pointer; transition: transform .14s ease, background .14s ease; }.send { background: var(--accent); color: var(--text-on-accent); }.send:not(:disabled):hover,.stop:hover { transform: translateY(-1px); }.send:not(:disabled):hover { background: var(--accent-hover); }.stop { background: var(--danger); color: var(--text-inverse); }.send:disabled { opacity: .3; }
@media (max-width: 720px) { .composer { width: calc(100% - 28px); margin-bottom: 12px; } }
</style>
