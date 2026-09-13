<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Files, Search, X } from 'lucide-vue-next'
import type { ProjectFileEntry, ProjectFilePreview } from '../../domain/models'
import { useI18n } from '../../services/i18n'
import { createProjectFilesClient } from '../../services/projectFiles'
import FilePreview from './FilePreview.vue'
import ProjectFileTree from './ProjectFileTree.vue'

const props = defineProps<{
  projectId: string
  projectName: string
  width: number
}>()
const emit = defineEmits<{
  close: []
  resize: [width: number]
  'add-to-conversation': [path: string, startLine: number, endLine: number, content: string]
  comment: [path: string, startLine: number, endLine: number, content: string, comment: string]
}>()
const { t } = useI18n()
const filterInput = ref<HTMLInputElement | null>(null)
const query = ref('')
const rootEntries = ref<ProjectFileEntry[]>([])
const searchEntries = ref<ProjectFileEntry[]>([])
const childrenByPath = ref<Record<string, ProjectFileEntry[]>>({})
const loadingPaths = ref<string[]>([])
const errorPaths = ref<Record<string, string>>({})
const rootLoading = ref(false)
const rootError = ref('')
const selectedPath = ref<string | null>(null)
const preview = ref<ProjectFilePreview | null>(null)
const previewLoading = ref(false)
const previewError = ref('')
let client = createProjectFilesClient(props.projectId)
let queryTimer: ReturnType<typeof setTimeout> | undefined
let previewVersion = 0
let resizeStart: { x: number; width: number } | null = null

watch(() => props.projectId, async (projectId) => {
  client.clear()
  client = createProjectFilesClient(projectId)
  resetState()
  await loadRoot()
})

watch(query, (value) => {
  if (queryTimer) clearTimeout(queryTimer)
  if (!value.trim()) {
    searchEntries.value = []
    return
  }
  queryTimer = setTimeout(async () => {
    try {
      const result = await client.search(value)
      if (result) searchEntries.value = result
    } catch {
      searchEntries.value = []
    }
  }, 120)
})

onBeforeUnmount(() => {
  if (queryTimer) clearTimeout(queryTimer)
  client.clear()
  stopResize()
})

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

function resetState() {
  query.value = ''
  rootEntries.value = []
  searchEntries.value = []
  childrenByPath.value = {}
  loadingPaths.value = []
  errorPaths.value = {}
  selectedPath.value = null
  preview.value = null
  previewError.value = ''
}

async function loadRoot(force = false) {
  rootLoading.value = true
  rootError.value = ''
  try {
    rootEntries.value = await client.listDirectory('', force)
  } catch (cause) {
    rootError.value = message(cause)
  } finally {
    rootLoading.value = false
  }
}

async function loadDirectory(path: string, force = false) {
  loadingPaths.value = [...loadingPaths.value.filter((item) => item !== path), path]
  const nextErrors = { ...errorPaths.value }
  delete nextErrors[path]
  errorPaths.value = nextErrors
  try {
    const entries = await client.listDirectory(path, force)
    childrenByPath.value = { ...childrenByPath.value, [path]: entries }
  } catch (cause) {
    errorPaths.value = { ...errorPaths.value, [path]: message(cause) }
  } finally {
    loadingPaths.value = loadingPaths.value.filter((item) => item !== path)
  }
}

async function openFile(path: string, force = false) {
  const version = ++previewVersion
  selectedPath.value = path
  previewLoading.value = true
  previewError.value = ''
  if (!force) preview.value = null
  try {
    const result = await client.read(path, force)
    if (version === previewVersion) preview.value = result
  } catch (cause) {
    if (version === previewVersion) previewError.value = message(cause)
  } finally {
    if (version === previewVersion) previewLoading.value = false
  }
}

function closePreview() {
  previewVersion += 1
  selectedPath.value = null
  preview.value = null
  previewLoading.value = false
  previewError.value = ''
}

async function copyContent(content: string) {
  await navigator.clipboard?.writeText(content)
}

async function saveFile(content: string) {
  if (!selectedPath.value) return
  previewLoading.value = true
  previewError.value = ''
  try {
    await client.write(selectedPath.value, content)
    await openFile(selectedPath.value, true)
  } catch (cause) {
    previewError.value = message(cause)
  } finally {
    previewLoading.value = false
  }
}

function addToConversation(path: string, startLine: number, endLine: number, content: string) {
  emit('add-to-conversation', path, startLine, endLine, content)
}

function addComment(path: string, startLine: number, endLine: number, content: string, comment: string) {
  emit('comment', path, startLine, endLine, content, comment)
}

function handleEscape() {
  if (query.value) {
    query.value = ''
    return
  }
  emit('close')
}

function startResize(event: PointerEvent) {
  resizeStart = { x: event.clientX, width: props.width }
  window.addEventListener('pointermove', resize)
  window.addEventListener('pointerup', stopResize)
}

function resize(event: PointerEvent) {
  if (!resizeStart) return
  emit('resize', Math.min(960, Math.max(520, resizeStart.width + resizeStart.x - event.clientX)))
}

function stopResize() {
  resizeStart = null
  window.removeEventListener('pointermove', resize)
  window.removeEventListener('pointerup', stopResize)
}

async function focusFilter() {
  await nextTick()
  filterInput.value?.focus()
}

defineExpose({ focusFilter })
loadRoot()
</script>

<template>
  <aside
    data-testid="files-drawer"
    class="files-drawer"
    :style="{ width: `${width}px` }"
    @keydown="handleEscape"
  >
    <div data-testid="drawer-resizer" class="drawer-resizer" @pointerdown="startResize" />
    <header class="drawer-header">
      <div class="drawer-title"><Files :size="15" /><strong>{{ t('files') }}</strong></div>
      <label class="file-filter">
        <Search :size="13" />
        <input ref="filterInput" data-testid="file-filter" v-model="query" :placeholder="t('filterFiles')" />
      </label>
      <button class="icon-button" type="button" :title="t('close')" @click="emit('close')"><X :size="17" /></button>
    </header>

    <div class="drawer-content" :class="{ 'has-preview': selectedPath }">
      <section class="tree-pane">
        <div v-if="rootLoading" class="drawer-state">{{ t('reading') }}</div>
        <div v-else-if="rootError" class="drawer-state error">
          <span>{{ rootError }}</span><button type="button" @click="loadRoot(true)">{{ t('refresh') }}</button>
        </div>
        <div v-else-if="query && !searchEntries.length" class="drawer-state">{{ t('filesEmpty') }}</div>
        <ProjectFileTree
          v-else
          :root-name="projectName"
          :entries="query ? searchEntries : rootEntries"
          :children-by-path="childrenByPath"
          :loading-paths="loadingPaths"
          :error-paths="errorPaths"
          :query="query"
          :selected-path="selectedPath"
          @expand="loadDirectory"
          @retry="(path) => loadDirectory(path, true)"
          @select="openFile"
        />
      </section>
      <FilePreview
        v-if="selectedPath"
        :preview="preview"
        :loading="previewLoading"
        :error="previewError"
        @refresh="openFile(selectedPath, true)"
        @close="closePreview"
        @copy="copyContent"
        @save="saveFile"
        @add-to-conversation="addToConversation"
        @comment="addComment"
      />
    </div>
  </aside>
</template>

<style scoped>
.files-drawer { position: relative; z-index: 5; display: flex; min-width: 520px; max-width: min(960px, calc(100vw - 260px)); min-height: 0; flex: 0 0 auto; flex-direction: column; border-left: 1px solid var(--border-subtle); background: var(--surface-root); box-shadow: -10px 0 28px rgb(0 0 0 / 4%); }.drawer-resizer { position: absolute; z-index: 2; top: 0; bottom: 0; left: -4px; width: 8px; cursor: col-resize; }.drawer-header { display: flex; height: 48px; flex: 0 0 48px; align-items: center; gap: 8px; padding: 0 9px 0 13px; border-bottom: 1px solid var(--border-subtle); background: var(--surface-header); }.drawer-title { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 11px; }.file-filter { display: flex; min-width: 120px; flex: 1; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid var(--border-subtle); border-radius: 7px; background: var(--surface-root); color: var(--text-muted); }.file-filter:focus-within { border-color: var(--accent); }.file-filter input { min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: 11px var(--font-sans); }.icon-button { display: grid; width: 28px; height: 28px; place-items: center; padding: 0; border: 0; border-radius: 7px; background: transparent; color: var(--text-muted); cursor: pointer; }.icon-button:hover { background: var(--surface-hover); color: var(--text-primary); }.drawer-content { display: flex; min-height: 0; flex: 1; }.tree-pane { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }.drawer-content.has-preview .tree-pane { width: 300px; flex: 0 0 300px; border-right: 1px solid var(--border-subtle); }.drawer-state { display: flex; min-height: 0; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 20px; color: var(--text-muted); font-size: 11px; text-align: center; }.drawer-state.error { color: var(--text-danger); }.drawer-state button { border: 0; background: transparent; color: var(--accent); cursor: pointer; }
</style>
