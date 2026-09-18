import { desktop, isDesktopPlatformAvailable } from '../platform/desktop'
import type { AppSettingsDto, AppSnapshot, ClaudeSessionMessage, ClaudeSettingsDto, CliDiagnosticDto, ManagedClaudeSettings, ProjectDto, ProjectFileEntry, ProjectFilePreview, QueuedTurnDto, RunAccepted, SlashCommandCatalogDto, TaskDto, TurnSubmission } from '../domain/models'
import type { TaskEvent } from '../domain/events'
import { translate } from './i18n'
import type { BrowserAnnotation } from './browserAnnotations'

const invoke = desktop.invoke.bind(desktop)

export const isDesktop = isDesktopPlatformAvailable

export interface BrowserPanelBounds {
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  visible: boolean
}

export async function chooseProjectDirectory(): Promise<string | null> {
  const selected = await desktop.openFiles({ directory: true, multiple: false, title: translate('selectProjectDirectory') })
  return typeof selected === 'string' ? selected : null
}

export async function chooseAttachmentFiles(title: string): Promise<string[]> {
  const selected = await desktop.openFiles({ multiple: true, title })
  return Array.isArray(selected) ? selected : selected ? [selected] : []
}

export const ipc = {
  openDoubaoInChrome: () => invoke<void>('open_doubao_in_chrome'),
  openBrowser: (url: string) => invoke<void>('open_browser', { url }),
  createBrowserTab: (tabId: string, bounds: BrowserPanelBounds) => invoke<void>('create_browser_tab', { tabId, bounds }),
  selectBrowserTab: (tabId: string) => invoke<void>('select_browser_tab', { tabId }),
  closeBrowserTab: (tabId: string) => invoke<void>('close_browser_tab', { tabId }),
  openBrowserPanel: (tabId: string, url: string, bounds: BrowserPanelBounds) =>
    invoke<void>('open_browser_panel', { tabId, url, bounds }),
  setBrowserPanelBounds: (bounds: BrowserPanelBounds) => invoke<void>('set_browser_panel_bounds', { bounds }),
  browserHistory: (tabId: string, direction: 'back' | 'forward') => invoke<void>('browser_history', { tabId, direction }),
  refreshBrowserPanel: (tabId: string) => invoke<void>('refresh_browser_panel', { tabId }),
  setBrowserAnnotationMode: (enabled: boolean, taskId?: string) => invoke<void>('set_browser_annotation_mode', { enabled, taskId }),
  listBrowserAnnotations: (taskId: string) => invoke<BrowserAnnotation[]>('list_browser_annotations', { taskId }),
  updateBrowserAnnotation: (taskId: string, id: string, comment: string) => invoke<BrowserAnnotation | undefined>('update_browser_annotation', { taskId, id, comment }),
  updateBrowserAnnotationStyle: (taskId: string, id: string, style: BrowserAnnotation['style']) => invoke<BrowserAnnotation | undefined>('update_browser_annotation_style', { taskId, id, style }),
  deleteBrowserAnnotation: (taskId: string, id: string) => invoke<void>('delete_browser_annotation', { taskId, id }),
  clearBrowserAnnotations: (taskId: string) => invoke<void>('clear_browser_annotations', { taskId }),
  closeBrowserPanel: () => invoke<void>('close_browser_panel'),
  confirmAppExit: () => invoke<void>('confirm_app_exit'),
  saveClipboardFile: (name: string, mimeType: string, bytes: number[]) =>
    invoke<string>('save_clipboard_file', { name, mimeType, bytes }),
  readDragFilePaths: () => invoke<string[]>('read_drag_file_paths'),
  snapshot: () => invoke<AppSnapshot>('get_snapshot'),
  refreshSessions: () => invoke<AppSnapshot>('refresh_claude_sessions'),
  sessionMessages: (taskId: string) => invoke<ClaudeSessionMessage[]>('get_claude_session_messages', { taskId }),
  addProject: (path: string) => invoke<ProjectDto>('add_project', { path }),
  removeProject: (projectId: string) => invoke<void>('remove_project', { projectId }),
  openProject: (projectId: string) => invoke<void>('open_project', { projectId }),
  openTerminal: (projectId: string) => invoke<void>('open_terminal', { projectId }),
  listProjectDirectory: (projectId: string, path: string) =>
    invoke<ProjectFileEntry[]>('list_project_directory', { projectId, path }),
  searchProjectFiles: (projectId: string, query: string, limit = 200) =>
    invoke<ProjectFileEntry[]>('search_project_files', { projectId, query, limit }),
  readProjectFile: (projectId: string, path: string) =>
    invoke<ProjectFilePreview>('read_project_file', { projectId, path }),
  writeProjectFile: (projectId: string, path: string, content: string) =>
    invoke<void>('write_project_file', { projectId, path, content }),
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
  upgradeClaude: () => invoke<CliDiagnosticDto>('upgrade_claude'),
  readRawLog: (taskId: string) => invoke<string>('read_raw_log', { taskId }),
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
