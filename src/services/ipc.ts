import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { AppSettingsDto, AppSnapshot, ClaudeSessionMessage, ClaudeSettingsDto, CliDiagnosticDto, ManagedClaudeSettings, ProjectDto, QueuedTurnDto, RunAccepted, SlashCommandCatalogDto, TaskDto, TurnSubmission } from '../domain/models'
import type { TaskEvent } from '../domain/events'
import { translate } from './i18n'

export const isDesktop = () => '__TAURI_INTERNALS__' in window

export async function chooseProjectDirectory(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title: translate('selectProjectDirectory') })
  return typeof selected === 'string' ? selected : null
}

export const ipc = {
  confirmAppExit: () => invoke<void>('confirm_app_exit'),
  readDragFilePaths: () => invoke<string[]>('read_drag_file_paths'),
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
  submitTurn: (taskId: string, prompt: string) => invoke<TurnSubmission>('submit_turn', { taskId, prompt }),
  listQueuedTurns: (taskId: string) => invoke<QueuedTurnDto[]>('list_queued_turns', { taskId }),
  updateQueuedTurn: (taskId: string, queuedTurnId: string, prompt: string) => invoke<QueuedTurnDto>('update_queued_turn', { taskId, queuedTurnId, prompt }),
  deleteQueuedTurn: (taskId: string, queuedTurnId: string) => invoke<void>('delete_queued_turn', { taskId, queuedTurnId }),
  adjustQueuedTurn: (taskId: string, queuedTurnId: string) => invoke<void>('adjust_queued_turn', { taskId, queuedTurnId }),
  sendQueuedTurn: (taskId: string, queuedTurnId: string) => invoke<RunAccepted>('send_queued_turn', { taskId, queuedTurnId }),
  cancelTask: (taskId: string) => invoke<void>('cancel_task', { taskId }),
  listSlashCommands: (projectId: string, force?: boolean) => invoke<SlashCommandCatalogDto>('list_slash_commands', { projectId, force }),
  setTaskModel: (taskId: string, model: string) => invoke<TaskDto>('set_task_model', { taskId, model }),
  setTaskPermissionMode: (taskId: string, mode: string) => invoke<TaskDto>('set_task_permission_mode', { taskId, mode }),
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
