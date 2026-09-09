<script setup lang="ts">
import type { TaskStatus } from '../../domain/events'

defineProps<{ status: TaskStatus }>()

const labels: Record<TaskStatus, string> = {
  idle: '空闲', starting: '启动中', running: '运行中', awaiting_permission: '等待确认',
  stopping: '停止中', completed: '已完成', interrupted: '已中断', failed: '失败',
}
</script>

<template><span class="status-pill" :class="`is-${status}`"><i />{{ labels[status] }}</span></template>

<style scoped>
.status-pill { display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 11px; }
.status-pill i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }
.is-running i, .is-starting i { background: var(--success); box-shadow: 0 0 0 3px rgba(109,166,122,.13); }
.is-awaiting_permission i { background: var(--warning); }
.is-failed i { background: var(--danger); }
.is-interrupted i { background: var(--warning); }
.is-completed i { background: var(--success); }
</style>
