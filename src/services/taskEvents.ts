import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTaskEvent, type TaskEvent } from '../domain/events'

export async function listenToTaskEvents(onEvent: (event: TaskEvent) => void): Promise<UnlistenFn> {
  return listen<unknown>('task-event', ({ payload }) => {
    if (isTaskEvent(payload)) onEvent(payload)
  })
}
