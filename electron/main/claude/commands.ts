import { randomUUID } from 'node:crypto'
import { AppError } from '../../shared/errors.js'
import { bridgeRequest } from './bridge-client.js'
import { diagnoseClaude } from './locator.js'
import type { Storage } from '../database/storage.js'
import { registerCommand } from '../ipc.js'

const catalogs = new Map<string, { commands: unknown[]; models: Array<{ value: string }> }>()
export function registerClaudeCommands(storage: Storage) {
  registerCommand('list_slash_commands', async ({ projectId, force }) => {
    const id = String(projectId); if (!force && catalogs.has(id)) return catalogs.get(id)
    const project = storage.getProject(id); const cli = await diagnoseClaude(storage.loadSettings().claudePath)
    if (!cli.path) throw new AppError('cli_not_ready', cli.message, true)
    const response = await bridgeRequest({ type: 'commands.list', requestId: randomUUID(), claudePath: cli.path, cwd: project.path })
    const catalog = { commands: Array.isArray(response.commands) ? response.commands : [], models: Array.isArray(response.models) ? response.models.filter(isModel) : [] }
    catalogs.set(id, catalog); return catalog
  })
  registerCommand('set_task_model', async ({ taskId, model }) => {
    const task = storage.getTask(String(taskId)); const value = String(model || '').trim()
    if (value) { const catalog = await getCatalog(storage, task.projectId); if (!catalog.models.some((item) => item.value === value)) throw new AppError('model_not_available', '所选模型不在当前项目可用模型列表中', true) }
    return storage.setTaskModel(task.id, value || null)
  })
  registerCommand('set_task_permission_mode', ({ taskId, mode }) => {
    const value = String(mode || '').trim(); if (value && !['default', 'acceptEdits', 'plan', 'dontAsk'].includes(value)) throw new AppError('invalid_permission_mode', '不支持的任务权限模式', true)
    return storage.setTaskPermissionMode(String(taskId), value ? value as 'default' | 'acceptEdits' | 'plan' | 'dontAsk' : null)
  })
}
async function getCatalog(storage: Storage, projectId: string) { if (catalogs.has(projectId)) return catalogs.get(projectId)!; const project = storage.getProject(projectId); const cli = await diagnoseClaude(storage.loadSettings().claudePath); if (!cli.path) throw new AppError('cli_not_ready', cli.message, true); const response = await bridgeRequest({ type: 'commands.list', requestId: randomUUID(), claudePath: cli.path, cwd: project.path }); const catalog = { commands: Array.isArray(response.commands) ? response.commands : [], models: Array.isArray(response.models) ? response.models.filter(isModel) : [] }; catalogs.set(projectId, catalog); return catalog }
function isModel(value: unknown): value is { value: string } { return !!value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string' }
