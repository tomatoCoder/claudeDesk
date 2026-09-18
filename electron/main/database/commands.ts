import type { AppSettingsDto, AppSnapshot } from '../../shared/contracts.js'
import { AppError } from '../../shared/errors.js'
import { registerCommand } from '../ipc.js'
import type { Storage } from './storage.js'

export function registerStorageCommands(storage: Storage) {
  registerCommand('get_snapshot', (): AppSnapshot => ({
    projects: storage.listProjects(),
    tasks: storage.listTasks(),
    settings: storage.loadSettings(),
    cli: { status: 'probe_failed', path: null, version: null, message: '正在检查 Claude Code…' },
  }))
  registerCommand('add_project', ({ path }) => storage.createOrTouchProject(requiredString(path, 'path')))
  registerCommand('remove_project', ({ projectId }) => storage.removeProject(requiredString(projectId, 'projectId')))
  registerCommand('create_task', ({ projectId, title }) => storage.createTask(requiredString(projectId, 'projectId'), typeof title === 'string' ? title : undefined))
  registerCommand('rename_task', ({ taskId, title }) => storage.renameTask(requiredString(taskId, 'taskId'), requiredString(title, 'title')))
  registerCommand('delete_task', ({ taskId }) => storage.deleteTask(requiredString(taskId, 'taskId')))
  registerCommand('list_task_events', ({ taskId, offset, limit }) => storage.listEvents(requiredString(taskId, 'taskId'), optionalInteger(offset), optionalInteger(limit, 5000)))
  registerCommand('save_settings', ({ settings }) => storage.saveSettings(requiredObject(settings, 'settings') as unknown as AppSettingsDto))
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new AppError('invalid_argument', `${name} 不能为空`, true)
  return value
}

function requiredObject(value: unknown, name: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalid_argument', `${name} 格式无效`, true)
  return value as Record<string, unknown>
}

function optionalInteger(value: unknown, fallback = 0) {
  return Number.isInteger(value) ? Number(value) : fallback
}
