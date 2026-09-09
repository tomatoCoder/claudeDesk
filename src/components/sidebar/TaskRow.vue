<script setup lang="ts">
import type { TaskDto } from '../../domain/models'
import StatusPill from '../common/StatusPill.vue'

defineProps<{ task: TaskDto; selected: boolean }>()
defineEmits<{ select: []; remove: [] }>()
</script>

<template>
  <div class="task-row" :class="{ selected }">
    <button type="button" class="task-select" @click="$emit('select')">
      <span class="task-title">{{ task.title }}</span><StatusPill :status="task.status" />
    </button>
    <button class="remove" type="button" title="删除任务" @click.stop="$emit('remove')">×</button>
  </div>
</template>

<style scoped>
.task-row { display: flex; align-items: center; margin: 2px 0 2px 16px; border-radius: var(--radius-sm); }
.task-row:hover, .selected { background: var(--surface-hover); }
.selected { box-shadow: inset 2px 0 var(--accent); }
.task-select { display: flex; flex: 1; min-width: 0; flex-direction: column; align-items: flex-start; gap: 4px; padding: 9px 9px 9px 11px; border: 0; background: transparent; cursor: pointer; text-align: left; }
.task-title { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-size: 13px; }
.remove { visibility: hidden; margin-right: 6px; border: 0; background: none; color: var(--text-muted); cursor: pointer; }
.task-row:hover .remove { visibility: visible; }.remove:hover { color: var(--danger); }
</style>
