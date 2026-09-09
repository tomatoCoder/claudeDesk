import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { AppSettingsDto, AppSnapshot, CliDiagnosticDto, ProjectDto, RunAccepted, TaskDto, WorkspaceDiff } from '../domain/models'
import type { TaskEvent } from '../domain/events'

export const isDesktop = () => '__TAURI_INTERNALS__' in window

export async function chooseProjectDirectory(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title: '选择项目目录' })
  return typeof selected === 'string' ? selected : null
}

export const ipc = {
  snapshot: () => invoke<AppSnapshot>('get_snapshot'),
  addProject: (path: string) => invoke<ProjectDto>('add_project', { path }),
  removeProject: (projectId: string) => invoke<void>('remove_project', { projectId }),
  createTask: (projectId: string, title?: string) => invoke<TaskDto>('create_task', { projectId, title }),
  renameTask: (taskId: string, title: string) => invoke<TaskDto>('rename_task', { taskId, title }),
  deleteTask: (taskId: string) => invoke<void>('delete_task', { taskId }),
  listEvents: (taskId: string) => invoke<TaskEvent[]>('list_task_events', { taskId, offset: 0, limit: 5000 }),
  sendTurn: (taskId: string, prompt: string) => invoke<RunAccepted>('send_turn', { taskId, prompt }),
  cancelTask: (taskId: string) => invoke<void>('cancel_task', { taskId }),
  resolvePermission: (taskId: string, requestId: string, decision: string, updatedInput: unknown, rule?: string) =>
    invoke<void>('resolve_permission', { taskId, requestId, decision, updatedInput, rule }),
  workspaceDiff: (projectId: string) => invoke<WorkspaceDiff>('get_workspace_diff', { projectId }),
  diagnoseClaude: () => invoke<CliDiagnosticDto>('diagnose_claude'),
  saveSettings: (settings: AppSettingsDto) => invoke<AppSettingsDto>('save_settings', { settings }),
  rawLog: (taskId: string) => invoke<string>('read_raw_log', { taskId }),
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error || '发生未知错误')
}
