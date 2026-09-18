export interface DesktopInvokeRequest {
  command: string
  args?: Record<string, unknown>
}

export interface OpenFilesOptions {
  directory?: boolean
  multiple?: boolean
  title?: string
}

export type TaskStatus = 'idle' | 'starting' | 'running' | 'awaiting_permission' | 'stopping' | 'completed' | 'interrupted' | 'failed'
export type TaskPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'dontAsk'

export interface ProjectDto {
  id: string
  name: string
  path: string
  createdAt: string
  lastOpenedAt: string
}

export interface TaskDto {
  id: string
  projectId: string
  title: string
  claudeSessionId: string | null
  status: TaskStatus
  modelOverride: string | null
  permissionModeOverride: TaskPermissionMode | null
  createdAt: string
  updatedAt: string
}

export interface AppSettingsDto {
  claudePath: string | null
  sidebarWidth: number
  theme: 'system' | 'dark' | 'light'
  language: 'zh-CN' | 'en-US'
  openWith: 'default' | 'qoder' | 'vscode' | 'intellij_idea'
  terminalApp: string
  permissionMode: 'default' | 'auto' | 'bypass'
}

export interface CliDiagnosticDto {
  status: 'ready' | 'not_found' | 'too_old' | 'probe_failed' | 'not_authenticated'
  path: string | null
  version: string | null
  message: string
}

export interface AppSnapshot {
  projects: ProjectDto[]
  tasks: TaskDto[]
  settings: AppSettingsDto
  cli: CliDiagnosticDto
}

export interface TaskEvent {
  version: 1
  taskId: string
  runId: string
  sequence: number
  createdAt: string
  kind: string
  data: Record<string, unknown>
}

export type DesktopEventName =
  | 'app-exit-requested'
  | 'browser-comment'
  | 'browser-annotations-changed'
  | 'browser-page-state'
  | 'queued-turns-changed'
  | 'slash-commands-changed'
  | 'task-event'
  | 'task-updated'

export const IPC_CHANNELS = {
  invoke: 'claude-desk:invoke',
  openFiles: 'claude-desk:open-files',
  event: (name: DesktopEventName) => `claude-desk:event:${name}`,
} as const

export const ALLOWED_COMMANDS = new Set([
  'open_doubao_in_chrome',
  'open_browser',
  'create_browser_tab',
  'select_browser_tab',
  'close_browser_tab',
  'open_browser_panel',
  'set_browser_panel_bounds',
  'browser_history',
  'refresh_browser_panel',
  'set_browser_annotation_mode',
  'list_browser_annotations',
  'update_browser_annotation',
  'update_browser_annotation_style',
  'delete_browser_annotation',
  'clear_browser_annotations',
  'close_browser_panel',
  'confirm_app_exit',
  'save_clipboard_file',
  'read_drag_file_paths',
  'get_snapshot',
  'refresh_claude_sessions',
  'get_claude_session_messages',
  'add_project',
  'remove_project',
  'open_project',
  'open_terminal',
  'list_project_directory',
  'search_project_files',
  'read_project_file',
  'write_project_file',
  'get_workspace_diff',
  'create_task',
  'rename_task',
  'delete_task',
  'list_task_events',
  'send_turn',
  'submit_turn',
  'list_queued_turns',
  'update_queued_turn',
  'delete_queued_turn',
  'adjust_queued_turn',
  'send_queued_turn',
  'cancel_task',
  'list_slash_commands',
  'set_task_model',
  'set_task_permission_mode',
  'resolve_permission',
  'diagnose_claude',
  'upgrade_claude',
  'read_raw_log',
  'save_settings',
  'get_claude_settings',
  'save_claude_settings',
  'save_claude_settings_json',
] as const)

export const ALLOWED_EVENTS = new Set<DesktopEventName>([
  'app-exit-requested',
  'browser-comment',
  'browser-annotations-changed',
  'browser-page-state',
  'queued-turns-changed',
  'slash-commands-changed',
  'task-event',
  'task-updated',
])
