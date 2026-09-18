import { randomUUID } from 'node:crypto'
import type { AppSnapshot } from '../../shared/contracts.js'
import { AppError } from '../../shared/errors.js'
import { bridgeRequest } from '../claude/bridge-client.js'
import { diagnoseClaude } from '../claude/locator.js'
import type { Storage } from '../database/storage.js'
import { registerCommand } from '../ipc.js'

export function registerSessionCommands(storage: Storage) {
  const snapshot = async (): Promise<AppSnapshot> => ({
    projects: storage.listProjects(), tasks: storage.listTasks(), settings: storage.loadSettings(),
    cli: await diagnoseClaude(storage.loadSettings().claudePath),
  })
  registerCommand('get_snapshot', snapshot)
  registerCommand('diagnose_claude', () => diagnoseClaude(storage.loadSettings().claudePath))
  registerCommand('refresh_claude_sessions', async () => {
    const diagnostic = await diagnoseClaude(storage.loadSettings().claudePath)
    if (diagnostic.status === 'ready' && diagnostic.path) {
      const response = await bridgeRequest({ type: 'catalog.list', requestId: randomUUID(), claudePath: diagnostic.path })
      const sessions = Array.isArray(response.sessions) ? response.sessions : []
      for (const value of sessions) {
        if (!isRecord(value) || typeof value.sessionId !== 'string' || typeof value.cwd !== 'string') continue
        try {
          const project = storage.createOrTouchProject(value.cwd)
          storage.upsertClaudeSession(project.id, value.sessionId, typeof value.title === 'string' ? value.title : '', new Date(typeof value.lastModified === 'number' ? value.lastModified : Date.now()).toISOString())
        } catch { /* Ignore sessions whose working directory no longer exists. */ }
      }
    }
    return snapshot()
  })
  registerCommand('get_claude_session_messages', async ({ taskId }) => {
    const task = storage.getTask(requiredString(taskId, 'taskId'))
    if (!task.claudeSessionId) throw new AppError('session_not_started', '该会话尚未写入 Claude 历史记录', true)
    const project = storage.getProject(task.projectId)
    const diagnostic = await diagnoseClaude(storage.loadSettings().claudePath)
    if (!diagnostic.path) throw new AppError('cli_not_found', '未找到 Claude Code CLI', true)
    const response = await bridgeRequest({ type: 'catalog.messages', requestId: randomUUID(), claudePath: diagnostic.path, cwd: project.path, sessionId: task.claudeSessionId })
    return Array.isArray(response.messages) ? response.messages : []
  })
  registerCommand('rename_task', async ({ taskId, title }) => {
    const id = requiredString(taskId, 'taskId'); const name = requiredString(title, 'title').trim(); const task = storage.getTask(id)
    if (task.claudeSessionId) {
      const project = storage.getProject(task.projectId)
      const diagnostic = await diagnoseClaude(storage.loadSettings().claudePath)
      if (!diagnostic.path) throw new AppError('cli_not_found', '未找到 Claude Code CLI', true)
      await bridgeRequest({ type: 'catalog.rename', requestId: randomUUID(), claudePath: diagnostic.path, cwd: project.path, sessionId: task.claudeSessionId, title: name })
    }
    return storage.renameTask(id, name)
  })
}

function requiredString(value: unknown, name: string) { if (typeof value !== 'string' || !value.trim()) throw new AppError('invalid_argument', `${name} 不能为空`, true); return value }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
