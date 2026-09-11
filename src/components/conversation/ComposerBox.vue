<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowUp, Square } from 'lucide-vue-next'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { useI18n } from '../../services/i18n'
import { isDesktop } from '../../services/ipc'

const props = defineProps<{ disabled?: boolean; running?: boolean }>()
const emit = defineEmits<{ send: [text: string]; stop: [] }>()
const text = ref('')
const composer = ref<HTMLElement | null>(null)
const textarea = ref<HTMLTextAreaElement | null>(null)
const dragActive = ref(false)
const { t } = useI18n()
let nativeDropUnlisten: UnlistenFn | undefined
let scaleFactor = window.devicePixelRatio || 1
let lastDropKey = ''
let lastDropAt = 0

function send() {
  const value = text.value.trim()
  if (!value || props.disabled || props.running) return
  text.value = ''
  emit('send', value)
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

function isInsideComposer(x: number, y: number) {
  const rect = composer.value?.getBoundingClientRect()
  return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

async function appendPaths(paths: string[]) {
  if (props.disabled || props.running) return
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

function handleBrowserDrop(event: DragEvent) {
  dragActive.value = false
  if (event.dataTransfer) void appendPaths(browserDropPaths(event.dataTransfer))
}

function handleBrowserDragLeave(event: DragEvent) {
  const current = event.currentTarget as HTMLElement
  if (!event.relatedTarget || !current.contains(event.relatedTarget as Node)) dragActive.value = false
}

async function installNativeDropListener() {
  if (!isDesktop()) return
  scaleFactor = await getCurrentWindow().scaleFactor()
  nativeDropUnlisten = await getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload
    if (payload.type === 'leave') {
      dragActive.value = false
      return
    }
    const position = payload.position.toLogical(scaleFactor)
    const inside = isInsideComposer(position.x, position.y)
    if (payload.type === 'drop') {
      dragActive.value = false
      if (inside) void appendPaths(payload.paths)
      return
    }
    dragActive.value = inside && !props.disabled && !props.running
  })
}

onMounted(() => { void installNativeDropListener() })
onBeforeUnmount(() => nativeDropUnlisten?.())
</script>

<template>
  <div ref="composer" class="composer" :class="{ 'drag-active': dragActive }" @dragenter.prevent="dragActive = !disabled && !running" @dragover.prevent="dragActive = !disabled && !running" @dragleave="handleBrowserDragLeave" @drop.prevent="handleBrowserDrop">
    <div v-if="dragActive" class="drop-hint">{{ t('dropFilesHere') }}</div>
    <textarea ref="textarea" v-model="text" rows="3" :disabled="disabled || running" :placeholder="running ? t('claudeWorking') : t('sendTaskPlaceholder')" :aria-label="t('sendMessage')" @keydown="keydown" />
    <div class="composer-footer"><span>{{ t('sendShortcut') }}</span><button v-if="running" class="stop" type="button" :title="t('stopTask')" @click="emit('stop')"><Square :size="14" /></button><button v-else class="send" type="button" :disabled="disabled || !text.trim()" :title="t('send')" @click="send"><ArrowUp :size="17" /></button></div>
  </div>
</template>

<style scoped>
.composer { position: relative; width: min(860px, calc(100% - 48px)); margin: 0 auto 17px; overflow: hidden; border: 1px solid var(--border-strong); border-radius: 18px; background: var(--surface-composer); box-shadow: var(--shadow-composer); transition: border-color .16s ease, box-shadow .16s ease; }.composer:focus-within { border-color: var(--accent-border); box-shadow: var(--shadow-composer-focus); }.composer.drag-active { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow-composer-focus); }.drop-hint { position: absolute; z-index: 2; inset: 0; display: grid; place-items: center; background: var(--surface-composer); color: var(--accent); font-size: 13px; font-weight: 650; pointer-events: none; }.composer textarea { display: block; width: 100%; min-height: 74px; max-height: 220px; resize: none; padding: 16px 17px 5px; border: 0; outline: 0; background: transparent; color: var(--text-primary); line-height: 1.55; }.composer textarea::placeholder { color: var(--text-muted); }.composer-footer { display: flex; min-height: 42px; align-items: center; justify-content: flex-end; gap: 10px; padding: 5px 9px 8px 16px; }.composer-footer span { margin-right: auto; color: var(--text-muted); font-size: 10px; }.send,.stop { display: grid; width: 31px; height: 31px; place-items: center; border: 0; border-radius: 10px; cursor: pointer; transition: transform .14s ease, background .14s ease; }.send { background: var(--accent); color: var(--text-on-accent); }.send:not(:disabled):hover,.stop:hover { transform: translateY(-1px); }.send:not(:disabled):hover { background: var(--accent-hover); }.stop { background: var(--danger); color: var(--text-inverse); }.send:disabled { opacity: .3; }
@media (max-width: 720px) { .composer { width: calc(100% - 28px); margin-bottom: 12px; } }
</style>
