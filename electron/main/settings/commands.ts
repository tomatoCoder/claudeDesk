import { AppError } from '../../shared/errors.js'
import { registerCommand } from '../ipc.js'
import { ClaudeSettingsRepository, type ManagedClaudeSettings } from './claude-settings.js'

export function registerClaudeSettingsCommands(repository: ClaudeSettingsRepository) {
  registerCommand('get_claude_settings', () => repository.load())
  registerCommand('save_claude_settings', ({ version, values }) => {
    if (typeof version !== 'string' || !isRecord(values)) throw new AppError('invalid_argument', 'Claude 设置参数无效', true)
    validate(values)
    return repository.save(version, values as Partial<ManagedClaudeSettings>)
  })
  registerCommand('save_claude_settings_json', ({ version, raw }) => {
    if (typeof version !== 'string' || typeof raw !== 'string') throw new AppError('invalid_argument', 'Claude 设置参数无效', true)
    return repository.saveRaw(version, raw)
  })
}

function validate(values: Record<string, unknown>) {
  const baseUrl = typeof values.baseUrl === 'string' ? values.baseUrl.trim() : ''
  if (baseUrl && !baseUrl.startsWith('https://') && !baseUrl.startsWith('http://localhost') && !baseUrl.startsWith('http://127.0.0.1')) throw new AppError('invalid_base_url', 'Base URL 必须使用 HTTPS；本机调试可使用 localhost', true)
  const threshold = typeof values.autoCompactThreshold === 'string' ? values.autoCompactThreshold.trim() : ''
  if (threshold && (!/^\d+$/.test(threshold) || Number(threshold) < 1 || Number(threshold) > 100)) throw new AppError('invalid_auto_compact_threshold', '自动压缩阈值必须是 1–100 之间的整数', true)
  const window = typeof values.autoCompactWindow === 'string' ? values.autoCompactWindow.trim() : ''
  if (window && (!/^\d+$/.test(window) || Number(window) < 100_000 || Number(window) > 1_000_000)) throw new AppError('invalid_auto_compact_window', '上下文窗口必须是 100000–1000000 之间的整数', true)
}

function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
