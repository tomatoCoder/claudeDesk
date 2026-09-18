import { isTaskEvent, type TaskEvent } from '../domain/events'
import { desktop, type Unlisten } from '../platform/desktop'

export async function listenToTaskEvents(onEvent: (event: TaskEvent) => void): Promise<Unlisten> {
  return desktop.listen<unknown>('task-event', (payload) => {
    if (isTaskEvent(payload)) onEvent(payload)
  })
}
