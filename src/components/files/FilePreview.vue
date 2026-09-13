<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue'
import { Copy, RefreshCw, X } from 'lucide-vue-next'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import type { ProjectFilePreview } from '../../domain/models'
import { useI18n } from '../../services/i18n'
import { renderMarkdown } from '../conversation/markdown'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('python', python)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)

const props = defineProps<{
  preview: ProjectFilePreview | null
  loading: boolean
  error: string
}>()
const emit = defineEmits<{
  refresh: []
  close: []
  copy: [content: string]
  'add-to-conversation': [path: string, startLine: number, endLine: number, content: string]
  comment: [path: string, startLine: number, endLine: number, content: string, comment: string]
  save: [content: string]
}>()
const { t } = useI18n()
const markdownPreview = ref(false)
const imageUrl = ref('')
const selection = ref<{ startLine: number; endLine: number; content: string } | null>(null)
const commentOpen = ref(false)
const commentText = ref('')
const editing = ref(false)
const draft = ref('')

const extension = computed(() => props.preview?.path.split('.').pop()?.toLowerCase() ?? '')
const isMarkdown = computed(() => ['md', 'markdown', 'mdown'].includes(extension.value))
const breadcrumbs = computed(() => props.preview?.path.split('/') ?? [])
const sourceLines = computed(() => (props.preview?.content ?? '').split('\n'))
const renderedMarkdown = computed(() => renderMarkdown(props.preview?.content ?? ''))
const language = computed(() => languageForExtension(extension.value))
const highlightedLines = computed(() => sourceLines.value.map((line) => {
  if (!language.value) return escapeHtml(line) || ' '
  return hljs.highlight(line || ' ', { language: language.value, ignoreIllegals: true }).value
}))

watch(() => props.preview?.path, () => {
  markdownPreview.value = false
  selection.value = null
  commentOpen.value = false
  editing.value = false
})
watchEffect((onCleanup) => {
  imageUrl.value = ''
  const preview = props.preview
  if (preview?.kind !== 'image' || !preview.bytes || !preview.mimeType) return
  const url = URL.createObjectURL(new Blob([Uint8Array.from(preview.bytes)], { type: preview.mimeType }))
  imageUrl.value = url
  onCleanup(() => URL.revokeObjectURL(url))
})

function languageForExtension(value: string) {
  const languages: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', json: 'json', rs: 'rust',
    sh: 'bash', bash: 'bash', zsh: 'bash', css: 'css', scss: 'css',
    html: 'xml', vue: 'xml', xml: 'xml', svg: 'xml', md: 'markdown',
    markdown: 'markdown', py: 'python', yaml: 'yaml', yml: 'yaml',
  }
  return languages[value] ?? null
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function formatSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MiB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${size} B`
}

function sourceLine(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement
  const value = element?.closest('.source-line')?.querySelector('.line-number')?.textContent
  return value ? Number(value) : null
}

function sourceCode(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest('.source-code')
}

function offsetInCode(code: Element, node: Node, offset: number) {
  try {
    const before = document.createRange()
    before.selectNodeContents(code)
    before.setEnd(node, offset)
    return before.toString().length
  } catch {
    return null
  }
}

function captureSelection() {
  if (props.preview?.kind !== 'text' || editing.value) return
  const nativeSelection = window.getSelection()
  const range = nativeSelection?.rangeCount ? nativeSelection.getRangeAt(0) : null
  if (!range || range.collapsed) return
  const startCode = sourceCode(range.startContainer)
  const endCode = sourceCode(range.endContainer)
  const startLine = sourceLine(startCode ?? null)
  const endLine = sourceLine(endCode ?? null)
  if (!startCode || !endCode || !startLine || !endLine) return
  const startOffset = offsetInCode(startCode, range.startContainer, range.startOffset)
  const endOffset = offsetInCode(endCode, range.endContainer, range.endOffset)
  if (startOffset === null || endOffset === null) return
  const content = startLine === endLine
    ? sourceLines.value[startLine - 1].slice(startOffset, endOffset)
    : [
        sourceLines.value[startLine - 1].slice(startOffset),
        ...sourceLines.value.slice(startLine, endLine - 1),
        sourceLines.value[endLine - 1].slice(0, endOffset),
      ].join('\n')
  if (!content) return
  selection.value = { startLine: Math.min(startLine, endLine), endLine: Math.max(startLine, endLine), content }
  commentOpen.value = false
}

function addToConversation() {
  if (!selection.value || !props.preview) return
  emit('add-to-conversation', props.preview.path, selection.value.startLine, selection.value.endLine, selection.value.content)
}

function openComment() {
  if (!selection.value) return
  commentText.value = ''
  commentOpen.value = true
}

function submitComment() {
  if (!selection.value || !props.preview || !commentText.value.trim()) return
  emit('comment', props.preview.path, selection.value.startLine, selection.value.endLine, selection.value.content, commentText.value.trim())
  commentOpen.value = false
}

function startEditing() {
  if (props.preview?.kind !== 'text') return
  draft.value = props.preview.content ?? ''
  editing.value = true
  selection.value = null
  commentOpen.value = false
  window.getSelection()?.removeAllRanges()
}

function cancelEditing() {
  editing.value = false
  draft.value = ''
}

function saveEditing() {
  emit('save', draft.value)
  editing.value = false
}
</script>

<template>
  <section class="file-preview">
    <header class="preview-header">
      <nav class="breadcrumbs" :title="preview?.path">
        <template v-for="(part, index) in breadcrumbs" :key="`${part}-${index}`">
          <span v-if="index" class="separator">›</span><span>{{ part }}</span>
        </template>
      </nav>
      <button v-if="isMarkdown && preview?.kind === 'text'" data-testid="toggle-markdown-preview" type="button" @click="markdownPreview = !markdownPreview">
        {{ markdownPreview ? t('viewSource') : t('viewPreview') }}
      </button>
      <template v-if="editing">
        <button data-testid="cancel-edit" type="button" @click="cancelEditing">{{ t('cancel') }}</button>
        <button data-testid="save-file" type="button" @click="saveEditing">{{ t('saveFile') }}</button>
      </template>
      <button data-testid="copy-file" class="icon-button" type="button" :title="t('copy')" :disabled="preview?.kind !== 'text'" @click="preview?.content != null && emit('copy', preview.content)"><Copy :size="14" /></button>
      <button class="icon-button" type="button" :title="t('refresh')" :disabled="!preview" @click="emit('refresh')"><RefreshCw :size="14" /></button>
      <button class="icon-button" type="button" :title="t('close')" @click="emit('close')"><X :size="16" /></button>
    </header>

    <div v-if="loading" class="preview-state">{{ t('reading') }}</div>
    <div v-else-if="error" class="preview-state error">{{ error }}</div>
    <div v-else-if="!preview" class="preview-state">{{ t('selectFilePreview') }}</div>
    <div v-else-if="preview.kind === 'binary'" class="preview-state"><strong>{{ t('binaryFile') }}</strong><span>{{ formatSize(preview.size) }}</span></div>
    <div v-else-if="preview.kind === 'too_large'" class="preview-state"><strong>{{ t('fileTooLarge') }}</strong><span>{{ formatSize(preview.size) }}</span></div>
    <div v-else-if="preview.kind === 'image'" class="image-preview"><img v-if="imageUrl" :src="imageUrl" :alt="preview.path" /><span>{{ formatSize(preview.size) }}</span></div>
    <div v-else-if="editing" class="editor-view"><textarea data-testid="file-editor" v-model="draft" :aria-label="t('editFile')" /></div>
    <div v-else-if="markdownPreview" class="markdown-preview" v-html="renderedMarkdown" />
    <div v-else class="source-view" @mouseup="captureSelection" @keyup.shift="captureSelection">
      <div v-if="selection" class="selection-actions" role="toolbar" :aria-label="t('selectedCodeActions')">
        <button data-testid="add-to-conversation" type="button" @click="addToConversation">{{ t('addToConversation') }}</button>
        <button data-testid="comment-selection" type="button" @click="openComment">{{ t('comment') }}</button>
        <button data-testid="edit-selection" type="button" @click="startEditing">{{ t('edit') }}</button>
      </div>
      <div v-if="commentOpen && selection" data-testid="comment-card" class="comment-card">
        <div class="comment-card-heading"><span class="comment-avatar">JA</span><span>{{ t('you') }}</span><strong>{{ t('localCommentRange', { start: selection.startLine, end: selection.endLine }) }}</strong></div>
        <textarea data-testid="comment-input" v-model="commentText" :placeholder="t('requestChanges')" />
        <footer><button type="button" @click="commentOpen = false">{{ t('cancel') }}</button><button data-testid="submit-comment" type="button" :disabled="!commentText.trim()" @click="submitComment">{{ t('comment') }}</button></footer>
      </div>
      <div v-for="(line, index) in highlightedLines" :key="index" class="source-line">
        <span class="line-number">{{ index + 1 }}</span><code class="source-code hljs" v-html="line" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.file-preview { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; background: var(--surface-root); }.preview-header { display: flex; height: 48px; flex: 0 0 48px; align-items: center; gap: 5px; padding: 0 8px 0 13px; border-bottom: 1px solid var(--border-subtle); background: var(--surface-header); }.breadcrumbs { display: flex; min-width: 0; flex: 1; align-items: center; gap: 5px; overflow: hidden; color: var(--text-secondary); font: 10px var(--font-mono); white-space: nowrap; }.breadcrumbs span { overflow: hidden; text-overflow: ellipsis; }.breadcrumbs .separator { flex: none; color: var(--text-muted); }.preview-header > button:not(.icon-button) { padding: 5px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 10px; }.preview-header > button:hover { background: var(--surface-hover); }.icon-button { display: grid; width: 28px; height: 28px; place-items: center; padding: 0; border: 0; border-radius: 7px; background: transparent; color: var(--text-muted); cursor: pointer; }.icon-button:disabled { opacity: .35; cursor: default; }.source-view { position: relative; min-width: 0; min-height: 0; flex: 1; overflow: auto; padding: 8px 0 30px; background: var(--surface-code); }.source-line { display: grid; min-width: max-content; grid-template-columns: 48px minmax(0,1fr); min-height: 21px; font: 12px/21px var(--font-mono); }.line-number { padding-right: 12px; color: var(--text-muted); text-align: right; user-select: none; }.source-code { display: block; padding-right: 18px; background: transparent; color: var(--text-primary); white-space: pre; }.source-code :deep(.hljs-keyword),.source-code :deep(.hljs-selector-tag) { color: #d45d5d; }.source-code :deep(.hljs-string),.source-code :deep(.hljs-attr) { color: #3e8b57; }.source-code :deep(.hljs-number),.source-code :deep(.hljs-literal) { color: #9b67c7; }.source-code :deep(.hljs-comment) { color: var(--text-muted); }.selection-actions { position: sticky; z-index: 2; top: 8px; display: flex; width: fit-content; margin: 0 0 8px 58px; overflow: hidden; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface-header); box-shadow: var(--shadow-lg); }.selection-actions button { padding: 6px 9px; border: 0; border-right: 1px solid var(--border-subtle); background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 11px; }.selection-actions button:last-child { border-right: 0; }.selection-actions button:hover { background: var(--surface-hover); color: var(--text-primary); }.comment-card { position: sticky; z-index: 3; top: 8px; width: min(430px, calc(100% - 32px)); margin: 0 16px 10px auto; padding: 13px; border: 1px solid var(--border-subtle); border-radius: 13px; background: var(--surface-root); box-shadow: var(--shadow-lg); }.comment-card-heading { display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 11px; }.comment-card-heading strong { margin-left: auto; font-weight: 500; }.comment-avatar { display: grid; width: 23px; height: 23px; place-items: center; border-radius: 50%; background: var(--accent); color: var(--text-on-accent); font-size: 9px; }.comment-card textarea { display: block; width: 100%; min-height: 56px; margin-top: 10px; resize: vertical; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: 12px/1.5 var(--font-sans); }.comment-card footer { display: flex; justify-content: flex-end; gap: 8px; }.comment-card footer button { padding: 5px 9px; border: 0; border-radius: 7px; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 11px; }.comment-card footer button:last-child { background: var(--accent); color: var(--text-on-accent); }.comment-card footer button:disabled { opacity: .4; cursor: default; }.editor-view { min-height: 0; flex: 1; padding: 10px; background: var(--surface-code); }.editor-view textarea { display: block; box-sizing: border-box; width: 100%; height: 100%; min-height: 240px; resize: none; padding: 10px; border: 1px solid var(--border-subtle); border-radius: 8px; outline: 0; background: var(--surface-root); color: var(--text-primary); font: 12px/1.7 var(--font-mono); }.markdown-preview { min-height: 0; flex: 1; overflow: auto; padding: 22px 28px 48px; color: var(--text-primary); line-height: 1.7; }.markdown-preview :deep(pre) { overflow: auto; padding: 12px; border-radius: 8px; background: var(--surface-code); }.markdown-preview :deep(code) { font-family: var(--font-mono); }.image-preview { display: flex; min-height: 0; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 10px; overflow: auto; padding: 24px; color: var(--text-muted); font-size: 10px; }.image-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }.preview-state { display: flex; min-height: 0; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; color: var(--text-muted); font-size: 11px; text-align: center; }.preview-state strong { color: var(--text-secondary); }.preview-state.error { color: var(--text-danger); }
</style>
