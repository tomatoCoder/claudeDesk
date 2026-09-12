import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { QueuedTurnsChanged } from '../domain/models'

export function isQueuedTurnsChanged(value: unknown): value is QueuedTurnsChanged {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  if (typeof event.taskId !== 'string' || !Array.isArray(event.queuedTurns)) return false
  return event.queuedTurns.every((turn) => {
    if (!turn || typeof turn !== 'object') return false
    const item = turn as Record<string, unknown>
    return typeof item.id === 'string'
      && item.taskId === event.taskId
      && typeof item.text === 'string'
      && typeof item.createdAt === 'string'
  })
}

export async function listenToQueuedTurns(onChange: (event: QueuedTurnsChanged) => void): Promise<UnlistenFn> {
  return listen<unknown>('queued-turns-changed', ({ payload }) => {
    if (isQueuedTurnsChanged(payload)) onChange(payload)
  })
}
