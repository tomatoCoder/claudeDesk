import { shell } from 'electron'
import { spawn } from 'node:child_process'
import type { AppSettingsDto } from '../../shared/contracts.js'
import { AppError } from '../../shared/errors.js'

export async function openProject(directory: string, openWith: AppSettingsDto['openWith']) {
  if (openWith === 'default') { const error = await shell.openPath(directory); if (error) throw new AppError('project_open_failed', error, true); return }
  const program = openWith === 'qoder' ? 'qoder' : openWith === 'vscode' ? 'code' : process.platform === 'win32' ? 'idea64' : 'idea'
  spawnDetached(program, [directory], directory, 'project_open_failed')
}

export function openTerminal(directory: string, terminal: string) {
  if (process.platform === 'darwin') {
    if (terminal === 'iterm') return spawnDetached('open', ['-a', 'iTerm', directory], directory, 'terminal_open_failed')
    const escaped = directory.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return spawnDetached('osascript', ['-e', `tell application "Terminal" to do script "cd \"${escaped}\""`], directory, 'terminal_open_failed')
  }
  if (process.platform === 'win32') {
    if (terminal === 'command_prompt') return spawnDetached('cmd', ['/C', 'start', '', 'cmd'], directory, 'terminal_open_failed')
    if (terminal === 'powershell') return spawnDetached('powershell', ['-NoExit', '-Command', `Set-Location -LiteralPath '${directory.replace(/'/g, "''")}'`], directory, 'terminal_open_failed')
    try { return spawnDetached('wt', ['-d', directory], directory, 'terminal_open_failed') } catch { return spawnDetached('cmd', ['/C', 'start', '', 'cmd'], directory, 'terminal_open_failed') }
  }
  throw new AppError('terminal_not_supported', '当前平台暂不支持打开终端', true)
}

function spawnDetached(program: string, args: string[], cwd: string, code: string) {
  try { const child = spawn(program, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false }); child.unref() }
  catch (error) { throw new AppError(code, error instanceof Error ? error.message : '无法启动应用', true) }
}
