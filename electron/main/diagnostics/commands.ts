import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AppError } from '../../shared/errors.js'
import { diagnoseClaude } from '../claude/locator.js'
import type { Storage } from '../database/storage.js'
import { registerCommand } from '../ipc.js'
import type { LogStore } from './log-store.js'

const execFileAsync = promisify(execFile)
export function registerDiagnosticCommands(storage: Storage, logs: LogStore) {
  registerCommand('diagnose_claude', () => diagnoseClaude(storage.loadSettings().claudePath))
  registerCommand('upgrade_claude', async () => {
    const custom = storage.loadSettings().claudePath; const diagnostic = await diagnoseClaude(custom)
    if (!diagnostic.path) throw new AppError('cli_not_found', '未找到可升级的 Claude Code CLI', true)
    try { await execFileAsync(diagnostic.path, ['update'], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }) }
    catch (error) { const detail = error instanceof Error ? error.message : String(error); throw new AppError('cli_upgrade_failed', `Claude Code 升级失败：${detail}`, true) }
    return diagnoseClaude(custom)
  })
  registerCommand('read_raw_log', ({ taskId }) => logs.read(String(taskId)))
}
