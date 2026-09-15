import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { TaskDto } from '../domain/models'

export function isTaskDto(value: unknown): value is TaskDto {
  if (!value || typeof value !== 'object') return false
  const task = value as Record<string, unknown>
  return typeof task.id === 'string'
    && typeof task.projectId === 'string'
    && typeof task.title === 'string'
    && (task.claudeSessionId === null || typeof task.claudeSessionId === 'string')
    && typeof task.status === 'string'
    && (task.modelOverride === null || typeof task.modelOverride === 'string')
    && (task.permissionModeOverride === null || typeof task.permissionModeOverride === 'string')
    && typeof task.createdAt === 'string'
    && typeof task.updatedAt === 'string'
}

// 后端自动命名等场景下广播的最新任务数据（如首条消息把标题改为用户消息摘要）。
export async function listenToTaskUpdates(onUpdate: (task: TaskDto) => void): Promise<UnlistenFn> {
  return listen<unknown>('task-updated', ({ payload }) => {
    if (isTaskDto(payload)) onUpdate(payload)
  })
}
