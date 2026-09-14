<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { ArrowUp, Paperclip, Square, X } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'
import { ipc, isDesktop } from '../../services/ipc'
import type { QueuedTurnDto, SlashCommandDto } from '../../domain/models'
import type { TaskStatus } from '../../domain/events'
import QueuedTurnList from './QueuedTurnList.vue'
import SlashCommandMenu from './SlashCommandMenu.vue'
import { filterSlashCommands } from '../../services/slashCommands'

const props = defineProps<{
  disabled?: boolean
  status: TaskStatus
  queuedTurns: QueuedTurnDto[]
  model?: string
  submit: (text: string) => Promise<boolean | void>
  adjust: (id: string) => Promise<void>
  sendNow: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  update: (id: string, text: string) => Promise<void>
  commands?: SlashCommandDto[]
  commandsLoading?: boolean
  commandsError?: string
}>()
const emit = defineEmits<{ stop: []; 'retry-commands': [] }>()
const text = ref('')
const attachments = ref<string[]>([])
const caret = ref(0)
const menuOpen = ref(false)
const menuDismissed = ref(false)
const activeIndex = ref(0)

const slashToken = computed<{ start: number; query: string } | null>(() => {
  const before = text.value.slice(0, caret.value)
  const match = before.match(/(?:^|\n)(\/\S*)$/)
  return match ? { start: caret.value - match[1].length, query: match[1].slice(1) } : null
})
const filtered = computed(() => filterSlashCommands(props.commands ?? [], slashToken.value?.query ?? ''))

function syncCaret() {
  const el = textarea.value
  caret.value = el?.selectionStart ?? text.value.length
  menuOpen.value = !menuDismissed.value && slashToken.value !== null
}

watch(slashToken, () => {
  menuDismissed.value = false
  activeIndex.value = 0
  menuOpen.value = slashToken.value !== null
})

// 目录在菜单打开期间被 slash-commands-changed 替换时，选中下标可能越界。
watch(filtered, (list) => { if (activeIndex.value >= list.length) activeIndex.value = Math.max(0, list.length - 1) })

const textarea = ref<HTMLTextAreaElement | null>(null)
const dragActive = ref(false)
const submitting = ref(false)
const busyIds = ref<string[]>([])
const { t } = useI18n()
let lastAddKey = ''
let lastAddAt = 0

const canSend = computed(() => !!text.value.trim() || attachments.value.length > 0)

async function send() {
  if (!canSend.value || props.disabled || submitting.value) return
  // 发送（含被上层拦截的裸命令）意味着补全结束，先关菜单避免其残留在对话框背后。
  menuDismissed.value = true
  menuOpen.value = false
  submitting.value = true
  try {
    // 附件路径逐行拼接在文本之后；文本为空时 prompt 只含路径行。
    const value = [text.value.trim(), ...attachments.value].filter(Boolean).join('\n')
    // submit 返回 false 表示裸命令被上层拦截（如 /model 打开对话框），此时保留输入与附件。
    const handled = await props.submit(value)
    if (handled !== false) { text.value = ''; attachments.value = [] }
  } catch {
    // App 层已展示 IPC 错误；保留输入内容供用户修正后重试。
  } finally { submitting.value = false }
}

function keydown(event: KeyboardEvent) {
  if (menuOpen.value) {
    // 空态（无匹配/加载中/出错）也允许 Escape 关闭菜单。
    if (event.key === 'Escape') { event.preventDefault(); menuDismissed.value = true; menuOpen.value = false; return }
    if (filtered.value.length > 0) {
      // IME 组合期间方向键留给候选窗，不劫持菜单导航。
      if (event.key === 'ArrowDown' && !event.isComposing) { event.preventDefault(); activeIndex.value = (activeIndex.value + 1) % filtered.value.length; return }
      if (event.key === 'ArrowUp' && !event.isComposing) { event.preventDefault(); activeIndex.value = (activeIndex.value - 1 + filtered.value.length) % filtered.value.length; return }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.isComposing) {
        const chosen = filtered.value[activeIndex.value]
        if (chosen) {
          event.preventDefault()
          insertCommand(chosen.command.name)
          return
        }
      }
    }
  }
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

function insertCommand(name: string) {
  const el = textarea.value
  const caretNow = el?.selectionStart ?? text.value.length
  const token = slashToken.value
  const start = token && token.start <= caretNow ? token.start : caretNow
  text.value = `${text.value.slice(0, start)}/${name} ${text.value.slice(caretNow)}`
  const position = start + name.length + 2
  caret.value = position
  menuOpen.value = false
  menuDismissed.value = false
  void nextTick(() => {
    el?.focus()
    el?.setSelectionRange(position, position)
  })
}

function addAttachments(paths: string[]) {
  if (props.disabled) return
  const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
    .filter((path) => !attachments.value.includes(path))
  if (!unique.length) return
  const now = Date.now()
  const key = unique.join('\0')
  if (key === lastAddKey && now - lastAddAt < 500) return
  lastAddKey = key
  lastAddAt = now
  attachments.value = [...attachments.value, ...unique]
}

function removeAttachment(path: string) {
  attachments.value = attachments.value.filter((item) => item !== path)
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

async function pickFiles() {
  if (props.disabled || !isDesktop()) return
  try {
    const selected = await open({ multiple: true, title: t('addAttachment') })
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
    if (paths.length) addAttachments(paths)
  } catch {
    // 对话框打开失败时静默忽略，不打断输入。
  }
}

async function handlePaste(event: ClipboardEvent) {
  if (props.disabled || !isDesktop()) return
  const files = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  if (!files.length) return

  // 文件粘贴由附件链路接管；普通文本仍保留 textarea 的原生粘贴行为。
  event.preventDefault()
  const paths: string[] = []
  for (const file of files) {
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
      paths.push(await ipc.saveClipboardFile(file.name, file.type, bytes))
    } catch {
      // 单个剪贴板文件失败不影响其余文件，也不打断当前输入。
    }
  }
  addAttachments(paths)
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
  addAttachments(paths)
  await nextTick()
  textarea.value?.focus()
}

function handleBrowserDragLeave(event: DragEvent) {
  const current = event.currentTarget as HTMLElement
  if (!event.relatedTarget || !current.contains(event.relatedTarget as Node)) dragActive.value = false
}

async function insert(textToInsert: string) {
  const prefix = text.value.trim() ? `${text.value.trimEnd()}\n` : ''
  text.value = `${prefix}${textToInsert}`
  await nextTick()
  textarea.value?.focus()
  const position = text.value.length
  textarea.value?.setSelectionRange(position, position)
  syncCaret()
}

defineExpose({ focus: () => textarea.value?.focus(), insert })
</script>

<template>
  <div class="composer-wrap">
    <!-- 补全菜单必须挂在 wrap 层：.composer 有 overflow:hidden（圆角裁剪），
         放在里面会被 bottom:calc(100%+6px) 的向上弹出定位整体裁掉。 -->
    <SlashCommandMenu v-if="menuOpen" :items="filtered" :active-index="activeIndex" :loading="!!commandsLoading" :error="commandsError ?? ''" @select="insertCommand(filtered[$event].command.name)" @retry="emit('retry-commands')" />
    <div class="composer" :class="{ 'drag-active': dragActive }" @dragenter.prevent="dragActive = !disabled" @dragover.prevent="dragActive = !disabled" @dragleave="handleBrowserDragLeave" @drop.prevent="handleBrowserDrop">
      <div v-if="dragActive" class="drop-hint">{{ t('dropFilesHere') }}</div>
      <QueuedTurnList :turns="queuedTurns" :status="status" :busy-ids="busyIds" @adjust="queueAction($event, adjust)" @send-now="queueAction($event, sendNow)" @remove="queueAction($event, remove)" @update="(id, value) => queueAction(id, () => update(id, value))" />
      <ul v-if="attachments.length" class="attachments">
        <li v-for="path in attachments" :key="path" class="attachment-chip" :title="path"><Paperclip :size="12" /><span class="attachment-name">{{ basename(path) }}</span><button class="attachment-remove" type="button" :title="t('removeAttachment')" :aria-label="`${t('removeAttachment')}：${basename(path)}`" @click="removeAttachment(path)"><X :size="12" /></button></li>
      </ul>
      <textarea ref="textarea" v-model="text" rows="3" :disabled="disabled" placeholder="随心输入" :aria-label="t('sendMessage')" @keydown="keydown" @paste="handlePaste" @input="syncCaret" @keyup="syncCaret" @click="syncCaret" @select="syncCaret" />
      <div class="composer-footer"><button v-if="isDesktop()" class="attach" type="button" :disabled="disabled" :title="t('addAttachment')" :aria-label="t('addAttachment')" @click="pickFiles"><Paperclip :size="16" /></button><span class="shortcut-hint">{{ t('sendShortcut') }}</span><span v-if="model" class="model-name" :title="model">{{ model }}</span><button v-if="['starting', 'running', 'awaiting_permission', 'stopping'].includes(status)" class="stop" type="button" :title="t('stopTask')" @click="emit('stop')"><Square :size="14" /></button><button data-testid="composer-submit" class="send" type="button" :disabled="disabled || submitting || !canSend" :title="t('send')" @click="send"><ArrowUp :size="17" /></button></div>
    </div>
  </div>
</template>

<style scoped>
.composer-wrap { position: relative; width: min(860px, calc(100% - 48px)); margin: 0 auto 17px; }.composer { position: relative; overflow: hidden; border: 1px solid var(--border-strong); border-radius: 18px; background: var(--surface-composer); box-shadow: var(--shadow-composer); transition: border-color .16s ease, box-shadow .16s ease; }.composer:focus-within { border-color: var(--accent-border); box-shadow: var(--shadow-composer-focus); }.composer.drag-active { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow-composer-focus); }.drop-hint { position: absolute; z-index: 2; inset: 0; display: grid; place-items: center; background: var(--surface-composer); color: var(--accent); font-size: 13px; font-weight: 650; pointer-events: none; }.composer textarea { display: block; width: 100%; min-height: 74px; max-height: 220px; resize: none; padding: 16px 17px 5px; border: 0; outline: 0; background: transparent; color: var(--text-primary); line-height: 1.55; }.composer textarea::placeholder { color: var(--text-muted); }.attachments { display: flex; flex: none; flex-wrap: wrap; gap: 6px; margin: 12px 17px 0; padding: 0; border: 0; list-style: none; }.attachment-chip { display: inline-flex; max-width: 240px; align-items: center; gap: 6px; padding: 4px 6px 4px 9px; border: 1px solid var(--border-strong); border-radius: 9px; background: var(--surface-option); color: var(--text-secondary); font-size: 11.5px; }.attachment-chip > svg { flex: none; color: var(--text-muted); }.attachment-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.attachment-remove { display: grid; flex: none; width: 16px; height: 16px; place-items: center; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--text-muted); cursor: pointer; transition: background .14s ease, color .14s ease; }.attachment-remove:hover { background: var(--surface-hover); color: var(--text-primary); }.composer-footer { display: flex; min-height: 42px; align-items: center; justify-content: flex-end; gap: 10px; padding: 5px 9px 8px 16px; }.composer-footer .shortcut-hint { margin-right: auto; color: var(--text-muted); font-size: 10px; }.model-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-size: 10.5px; }.send,.stop,.attach { display: grid; width: 31px; height: 31px; place-items: center; border: 0; border-radius: 10px; cursor: pointer; transition: transform .14s ease, background .14s ease, color .14s ease; }.send { background: var(--accent); color: var(--text-on-accent); }.send:not(:disabled):hover,.stop:hover { transform: translateY(-1px); }.send:not(:disabled):hover { background: var(--accent-hover); }.stop { background: var(--danger); color: var(--text-inverse); }.send:disabled { opacity: .3; }.attach { padding: 0; background: transparent; color: var(--text-muted); }.attach:not(:disabled):hover { background: var(--surface-hover); color: var(--text-secondary); transform: translateY(-1px); }.attach:disabled { opacity: .3; cursor: default; }
@media (max-width: 720px) { .composer-wrap { width: calc(100% - 28px); margin-bottom: 12px; } }
</style>
