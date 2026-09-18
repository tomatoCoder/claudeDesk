import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopEventName, OpenFilesOptions } from '../shared/contracts.js'

// Keep the sandboxed preload self-contained: CommonJS preload cannot require the
// main process's ESM output at runtime.
const invokeChannel = 'claude-desk:invoke'
const openFilesChannel = 'claude-desk:open-files'
const eventChannel = (name: DesktopEventName) => `claude-desk:event:${name}`
const allowedCommands = new Set([
  'open_doubao_in_chrome', 'open_browser', 'create_browser_tab', 'select_browser_tab', 'close_browser_tab', 'open_browser_panel', 'set_browser_panel_bounds', 'browser_history',
  'refresh_browser_panel', 'set_browser_annotation_mode', 'close_browser_panel', 'confirm_app_exit', 'save_clipboard_file',
  'list_browser_annotations', 'update_browser_annotation', 'update_browser_annotation_style', 'delete_browser_annotation', 'clear_browser_annotations',
  'read_drag_file_paths', 'get_snapshot', 'refresh_claude_sessions', 'get_claude_session_messages', 'add_project',
  'remove_project', 'open_project', 'open_terminal', 'list_project_directory', 'search_project_files', 'read_project_file',
  'write_project_file', 'get_workspace_diff', 'create_task', 'rename_task', 'delete_task', 'list_task_events', 'send_turn', 'submit_turn',
  'list_queued_turns', 'update_queued_turn', 'delete_queued_turn', 'adjust_queued_turn', 'send_queued_turn', 'cancel_task',
  'list_slash_commands', 'set_task_model', 'set_task_permission_mode', 'resolve_permission', 'diagnose_claude',
  'upgrade_claude', 'read_raw_log', 'save_settings', 'get_claude_settings', 'save_claude_settings', 'save_claude_settings_json',
])
const allowedEvents = new Set<DesktopEventName>(['app-exit-requested', 'browser-comment', 'browser-annotations-changed', 'browser-page-state', 'queued-turns-changed', 'slash-commands-changed', 'task-event', 'task-updated'])

contextBridge.exposeInMainWorld('claudeDeskDesktop', {
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!allowedCommands.has(command)) return Promise.reject(new Error('不支持的桌面命令'))
    return ipcRenderer.invoke(invokeChannel, { command, args })
  },
  listen: async (event: DesktopEventName, handler: (payload: unknown) => void) => {
    if (!allowedEvents.has(event)) throw new Error('不支持的桌面事件')
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => handler(payload)
    ipcRenderer.on(eventChannel(event), listener)
    return () => ipcRenderer.removeListener(eventChannel(event), listener)
  },
  openFiles: (options: OpenFilesOptions) => ipcRenderer.invoke(openFilesChannel, options),
  filePath: (file: File) => webUtils.getPathForFile(file),
})
