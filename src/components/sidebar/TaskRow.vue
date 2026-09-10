<script setup lang="ts">
import { ref } from 'vue'
import type { TaskDto } from '../../domain/models'
import StatusPill from '../common/StatusPill.vue'

defineProps<{ task: TaskDto; selected: boolean }>()
const emit = defineEmits<{ select: []; rename: []; remove: [] }>()
const menuOpen = ref(false)

function action(kind: 'rename' | 'remove') {
  menuOpen.value = false
  if (kind === 'rename') emit('rename')
  else emit('remove')
}
</script>

<template>
  <div class="task-row" :class="{ selected }" @contextmenu.prevent="menuOpen = true" @mouseleave="menuOpen = false">
    <button type="button" class="task-select" @click="emit('select')">
      <span class="task-title">{{ task.title }}</span><StatusPill :status="task.status" />
    </button>
    <div v-if="menuOpen" class="session-menu" role="menu">
      <button type="button" role="menuitem" data-action="rename" @click="action('rename')">重命名</button>
      <button type="button" role="menuitem" data-action="remove" class="danger" @click="action('remove')">删除</button>
    </div>
  </div>
</template>

<style scoped>
.task-row { position: relative; display: flex; align-items: center; margin: 2px 0 2px 16px; border-radius: var(--radius-sm); }
.task-row:hover, .selected { background: var(--surface-hover); }.selected { box-shadow: inset 2px 0 var(--accent); }
.task-select { display: flex; flex: 1; min-width: 0; flex-direction: column; align-items: flex-start; gap: 4px; padding: 9px 9px 9px 11px; border: 0; background: transparent; cursor: pointer; text-align: left; }
.task-title { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-size: 13px; }
.session-menu { position: absolute; z-index: 20; top: 30px; right: 6px; display: grid; min-width: 116px; padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-raised); box-shadow: var(--shadow-lg); }
.session-menu button { padding: 7px 9px; border: 0; border-radius: 5px; background: none; color: var(--text-primary); cursor: pointer; text-align: left; }.session-menu button:hover { background: var(--surface-hover); }.session-menu .danger { color: #f3b0b0; }
</style>
