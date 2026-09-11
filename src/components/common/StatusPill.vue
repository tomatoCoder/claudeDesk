<script setup lang="ts">
import type { TaskStatus } from '../../domain/events'
import { useI18n } from '../../services/i18n'

defineProps<{ status: TaskStatus }>()

const { t } = useI18n()
const labels = {
  idle: 'statusIdle', starting: 'statusStarting', running: 'statusRunning', awaiting_permission: 'statusAwaiting',
  stopping: 'statusStopping', completed: 'statusCompleted', interrupted: 'statusInterrupted', failed: 'statusFailed',
} as const satisfies Record<TaskStatus, Parameters<typeof t>[0]>
</script>

<template><span class="status-pill" :class="`is-${status}`"><i />{{ t(labels[status]) }}</span></template>

<style scoped>
.status-pill { display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 11px; }
.status-pill i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }
.is-running i, .is-starting i { background: var(--success); box-shadow: 0 0 0 3px var(--success-ring); }
.is-awaiting_permission i { background: var(--warning); }
.is-failed i { background: var(--danger); }
.is-interrupted i { background: var(--warning); }
.is-completed i { background: var(--success); }
</style>
