import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { AppSettingsDto, AppSnapshot, ClaudeSessionMessage, ClaudeSettingsDto, CliDiagnosticDto, ManagedClaudeSettings, ProjectDto, RunAccepted, TaskDto } from '../domain/models'
import type { TaskEvent } from '../domain/events'
import { translate } from './i18n'

export const isDesktop = () => '__TAURI_INTERNALS__' in window

export async function chooseProjectDirectory(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title: translate('selectProjectDirectory') })
  return typeof selected === 'string' ? selected : null
}

export const ipc = {
  confirmAppExit: () => invoke<void>('confirm_app_exit'),
  snapshot: () => invoke<AppSnapshot>('get_snapshot'),
  refreshSessions: () => invoke<AppSnapshot>('refresh_claude_sessions'),
  sessionMessages: (taskId: string) => invoke<ClaudeSessionMessage[]>('get_claude_session_messages', { taskId }),
  addProject: (path: string) => invoke<ProjectDto>('add_project', { path }),
  removeProject: (projectId: string) => invoke<void>('remove_project', { projectId }),
  openProject: (projectId: string) => invoke<void>('open_project', { projectId }),
  createTask: (projectId: string, title?: string) => invoke<TaskDto>('create_task', { projectId, title }),
  renameTask: (taskId: string, title: string) => invoke<TaskDto>('rename_task', { taskId, title }),
  deleteTask: (taskId: string) => invoke<void>('delete_task', { taskId }),
  listEvents: (taskId: string) => invoke<TaskEvent[]>('list_task_events', { taskId, offset: 0, limit: 5000 }),
  sendTurn: (taskId: string, prompt: string) => invoke<RunAccepted>('send_turn', { taskId, prompt }),
  cancelTask: (taskId: string) => invoke<void>('cancel_task', { taskId }),
  resolvePermission: (taskId: string, requestId: string, decision: string, updatedInput: unknown, permissionUpdate?: unknown) =>
    invoke<void>('resolve_permission', { taskId, requestId, decision, updatedInput, permissionUpdate }),
  diagnoseClaude: () => invoke<CliDiagnosticDto>('diagnose_claude'),
  saveSettings: (settings: AppSettingsDto) => invoke<AppSettingsDto>('save_settings', { settings }),
  loadClaudeSettings: () => invoke<ClaudeSettingsDto>('get_claude_settings'),
  saveClaudeSettings: (version: string, values: ManagedClaudeSettings) =>
    invoke<ClaudeSettingsDto>('save_claude_settings', { version, values }),
  saveClaudeSettingsJson: (version: string, raw: string) =>
    invoke<ClaudeSettingsDto>('save_claude_settings_json', { version, raw }),
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error || translate('unknownError'))
}
