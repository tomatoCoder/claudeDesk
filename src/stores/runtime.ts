import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { TaskEvent } from '../domain/events'
import type { QueuedTurnDto, QueuedTurnsChanged } from '../domain/models'
import { ipc } from '../services/ipc'
import { sessionMessagesToEvents } from '../services/sessionMessages'

export const useRuntimeStore = defineStore('runtime', () => {
  const byTask = reactive<Record<string, TaskEvent[]>>({})
  const queuedByTask = reactive<Record<string, QueuedTurnDto[]>>({})
  const loadingTaskId = ref<string | null>(null)

  async function load(taskId: string) {
    loadingTaskId.value = taskId
    try {
      const local = await ipc.listEvents(taskId)
      if (local.length) byTask[taskId] = dedupe(local)
      else {
        try { byTask[taskId] = sessionMessagesToEvents(taskId, await ipc.sessionMessages(taskId)) }
        catch { byTask[taskId] = [] }
      }
    }
    finally { if (loadingTaskId.value === taskId) loadingTaskId.value = null }
  }

  function accept(event: TaskEvent) {
    const list = byTask[event.taskId] ?? (byTask[event.taskId] = [])
    if (!list.some((item) => item.runId === event.runId && item.sequence === event.sequence)) list.push(event)
  }

  function events(taskId: string | null): TaskEvent[] { return taskId ? byTask[taskId] ?? [] : [] }

  async function loadQueuedTurns(taskId: string) {
    queuedByTask[taskId] = await ipc.listQueuedTurns(taskId)
  }

  function replaceQueuedTurns(event: QueuedTurnsChanged) {
    queuedByTask[event.taskId] = event.queuedTurns
  }

  function queuedTurns(taskId: string | null): QueuedTurnDto[] {
    return taskId ? queuedByTask[taskId] ?? [] : []
  }

  return { byTask, queuedByTask, loadingTaskId, load, accept, events, loadQueuedTurns, replaceQueuedTurns, queuedTurns }
})

function dedupe(events: TaskEvent[]) {
  const seen = new Set<string>()
  return events.filter((event) => {
    const key = `${event.runId}:${event.sequence}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
