import type { Storage } from '../database/storage.js'
import { workspaceDiff } from '../git/service.js'
import { registerCommand } from '../ipc.js'
import { openProject, openTerminal } from './desktop.js'

export function registerSystemCommands(storage: Storage) {
  registerCommand('open_project', ({ projectId }) => { const project = storage.getProject(String(projectId)); return openProject(project.path, storage.loadSettings().openWith) })
  registerCommand('open_terminal', ({ projectId }) => { const project = storage.getProject(String(projectId)); return openTerminal(project.path, storage.loadSettings().terminalApp) })
  registerCommand('get_workspace_diff', ({ projectId }) => workspaceDiff(storage.getProject(String(projectId)).path))
}
