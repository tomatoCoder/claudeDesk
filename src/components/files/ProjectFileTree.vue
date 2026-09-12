<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, File, Folder, FolderOpen, RefreshCw } from 'lucide-vue-next'
import type { ProjectFileEntry } from '../../domain/models'
import { sortProjectEntries } from '../../services/projectFiles'

const props = defineProps<{
  rootName: string
  entries: ProjectFileEntry[]
  childrenByPath: Record<string, ProjectFileEntry[]>
  loadingPaths: string[]
  errorPaths: Record<string, string>
  query: string
  selectedPath: string | null
}>()
const emit = defineEmits<{
  expand: [path: string]
  retry: [path: string]
  select: [path: string]
}>()

interface VisibleRow {
  entry: ProjectFileEntry
  level: number
}

const expanded = ref(new Set<string>())
const activeIndex = ref(0)

const visibleRows = computed(() => {
  if (props.query) return sortProjectEntries(props.entries).map((entry) => ({ entry, level: 1 }))
  const rows: VisibleRow[] = []
  const append = (entries: ProjectFileEntry[], level: number) => {
    for (const entry of sortProjectEntries(entries)) {
      rows.push({ entry, level })
      if (entry.kind === 'directory' && expanded.value.has(entry.path)) {
        append(props.childrenByPath[entry.path] ?? [], level + 1)
      }
    }
  }
  append(props.entries, 1)
  return rows
})

watch(visibleRows, (rows) => {
  activeIndex.value = Math.min(activeIndex.value, Math.max(0, rows.length - 1))
})

function setExpanded(path: string, value: boolean) {
  const next = new Set(expanded.value)
  if (value) next.add(path)
  else next.delete(path)
  expanded.value = next
}

function toggle(entry: ProjectFileEntry) {
  if (entry.kind === 'file') {
    emit('select', entry.path)
    return
  }
  const opening = !expanded.value.has(entry.path)
  setExpanded(entry.path, opening)
  if (opening && !Object.hasOwn(props.childrenByPath, entry.path)) emit('expand', entry.path)
}

function activeRow() {
  return visibleRows.value[activeIndex.value]
}

function keydown(event: KeyboardEvent) {
  if (!visibleRows.value.length) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, visibleRows.value.length - 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const row = activeRow()
    if (row) toggle(row.entry)
  } else if (event.key === 'ArrowRight') {
    const row = activeRow()
    if (!row || row.entry.kind !== 'directory') return
    event.preventDefault()
    if (!expanded.value.has(row.entry.path)) toggle(row.entry)
  } else if (event.key === 'ArrowLeft') {
    const row = activeRow()
    if (!row) return
    if (row.entry.kind === 'directory' && expanded.value.has(row.entry.path)) {
      event.preventDefault()
      setExpanded(row.entry.path, false)
      return
    }
    const parent = row.entry.path.split('/').slice(0, -1).join('/')
    const parentIndex = visibleRows.value.findIndex(({ entry }) => entry.path === parent)
    if (parentIndex >= 0) {
      event.preventDefault()
      activeIndex.value = parentIndex
    }
  }
}
</script>

<template>
  <div class="project-tree-wrap">
    <div class="tree-root" :title="rootName"><FolderOpen :size="14" /><strong>{{ rootName }}</strong></div>
    <div class="project-tree" role="tree" tabindex="0" @keydown="keydown">
      <template v-for="(row, index) in visibleRows" :key="row.entry.path">
        <button
          class="tree-row"
          :class="{ active: index === activeIndex, selected: row.entry.path === selectedPath }"
          type="button"
          role="treeitem"
          :data-path="row.entry.path"
          :aria-level="query ? 1 : row.level"
          :aria-expanded="row.entry.kind === 'directory' ? expanded.has(row.entry.path) : undefined"
          :style="{ '--tree-level': query ? 0 : row.level - 1 }"
          @mouseenter="activeIndex = index"
          @click="toggle(row.entry)"
        >
          <ChevronRight v-if="row.entry.kind === 'directory'" class="chevron" :class="{ open: expanded.has(row.entry.path) }" :size="13" />
          <span v-else class="chevron-placeholder" />
          <FolderOpen v-if="row.entry.kind === 'directory' && expanded.has(row.entry.path)" :size="14" />
          <Folder v-else-if="row.entry.kind === 'directory'" :size="14" />
          <File v-else :size="14" />
          <span class="tree-label" :title="row.entry.path">{{ query ? row.entry.path : row.entry.name }}</span>
          <span v-if="loadingPaths.includes(row.entry.path)" class="loading-dot" aria-label="loading" />
        </button>
        <div
          v-if="row.entry.kind === 'directory' && expanded.has(row.entry.path) && errorPaths[row.entry.path]"
          class="tree-error"
          :style="{ '--tree-level': row.level }"
        >
          <span>{{ errorPaths[row.entry.path] }}</span>
          <button type="button" :data-retry="row.entry.path" @click.stop="emit('retry', row.entry.path)"><RefreshCw :size="12" /></button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.project-tree-wrap { display: flex; min-height: 0; flex: 1; flex-direction: column; }.tree-root { display: flex; align-items: center; gap: 7px; padding: 9px 11px 7px; color: var(--text-secondary); font-size: 11px; }.tree-root strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.project-tree { min-height: 0; flex: 1; overflow: auto; padding: 3px 6px 12px; outline: none; }.tree-row { display: grid; width: 100%; grid-template-columns: 14px 15px minmax(0,1fr) auto; align-items: center; gap: 5px; padding: 6px 7px 6px calc(7px + var(--tree-level) * 15px); border: 0; border-radius: 6px; background: transparent; color: var(--text-secondary); cursor: default; font-size: 11px; text-align: left; }.tree-row:hover,.tree-row.active { background: var(--surface-hover); color: var(--text-primary); }.tree-row.selected { background: var(--accent-soft); color: var(--accent); }.chevron { transition: transform .12s ease; }.chevron.open { transform: rotate(90deg); }.chevron-placeholder { width: 13px; }.tree-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.loading-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: pulse 1s ease-in-out infinite; }.tree-error { display: flex; align-items: center; gap: 5px; padding: 4px 8px 4px calc(27px + var(--tree-level) * 15px); color: var(--text-danger); font-size: 10px; }.tree-error span { min-width: 0; overflow: hidden; flex: 1; text-overflow: ellipsis; white-space: nowrap; }.tree-error button { display: grid; place-items: center; padding: 3px; border: 0; background: transparent; color: inherit; cursor: pointer; }@keyframes pulse { 50% { opacity: .3; } }
</style>
