<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { TaskDto } from '../../domain/models'
import { useI18n } from '../../services/i18n'
import StatusPill from '../common/StatusPill.vue'

const props = defineProps<{ task: TaskDto; selected: boolean }>()
const emit = defineEmits<{ select: []; rename: [title: string]; remove: [] }>()
const menuOpen = ref(false)
const editing = ref(false)
const titleDraft = ref('')
const titleInput = ref<HTMLInputElement | null>(null)
const { t } = useI18n()

function openMenu() {
  if (!editing.value) menuOpen.value = true
}

async function startRename() {
  menuOpen.value = false
  titleDraft.value = props.task.title
  editing.value = true
  await nextTick()
  titleInput.value?.select()
}

function commitRename() {
  if (!editing.value) return
  const title = titleDraft.value.trim()
  editing.value = false
  if (title && title !== props.task.title) emit('rename', title)
}

function cancelRename() {
  editing.value = false
}

function remove() {
  menuOpen.value = false
  emit('remove')
}
</script>

<template>
  <div class="task-row" :class="{ selected, editing }" @contextmenu.prevent="openMenu" @mouseleave="menuOpen = false">
    <input v-if="editing" ref="titleInput" v-model="titleDraft" class="rename-input" type="text" @keydown.enter.prevent="commitRename" @keydown.esc.prevent="cancelRename" @blur="commitRename" />
    <button v-else type="button" class="task-select" @click="emit('select')">
      <span class="task-title">{{ task.title }}</span><StatusPill :status="task.status" />
    </button>
    <div v-if="menuOpen" class="session-menu" role="menu">
      <button type="button" role="menuitem" data-action="rename" @click="startRename">{{ t('rename') }}</button>
      <button type="button" role="menuitem" data-action="remove" class="danger" @click="remove">{{ t('delete') }}</button>
    </div>
  </div>
</template>

<style scoped>
.task-row { position: relative; display: flex; align-items: center; margin: 2px 0 2px 16px; border-radius: var(--radius-sm); }
.task-row:hover, .selected { background: var(--surface-hover); }.selected { box-shadow: inset 2px 0 var(--accent); }
.task-select { display: flex; flex: 1; min-width: 0; flex-direction: column; align-items: flex-start; gap: 4px; padding: 9px 9px 9px 11px; border: 0; background: transparent; cursor: pointer; text-align: left; }
.task-title { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-size: 13px; }
.rename-input { width: calc(100% - 10px); margin: 6px 5px; padding: 7px 8px; border: 1px solid var(--accent); border-radius: 6px; outline: 0; background: var(--surface-input); color: var(--text-primary); font-size: 13px; box-shadow: 0 0 0 2px var(--accent-soft); }
.session-menu { position: absolute; z-index: 20; top: 30px; right: 6px; display: grid; min-width: 116px; padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-raised); box-shadow: var(--shadow-lg); }
.session-menu button { padding: 7px 9px; border: 0; border-radius: 5px; background: none; color: var(--text-primary); cursor: pointer; text-align: left; }.session-menu button:hover { background: var(--surface-hover); }.session-menu .danger { color: var(--text-danger); }
</style>
