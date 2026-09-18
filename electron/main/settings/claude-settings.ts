import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { AppError } from '../../shared/errors.js'

const keys = {
  authToken: 'ANTHROPIC_AUTH_TOKEN', baseUrl: 'ANTHROPIC_BASE_URL', model: 'ANTHROPIC_MODEL',
  threshold: 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', window: 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', disabled: 'DISABLE_AUTO_COMPACT',
} as const

export interface ManagedClaudeSettings { authToken: string; baseUrl: string; model: string; autoCompact: boolean; autoCompactThreshold: string; autoCompactWindow: string }
export interface ClaudeSettingsView { values: ManagedClaudeSettings; raw: string; version: string; path: string }

export class ClaudeSettingsRepository {
  readonly filePath = path.join(os.homedir(), '.claude', 'settings.json')

  load(): ClaudeSettingsView {
    const bytes = read(this.filePath)
    const root = parseRoot(bytes)
    const env = isRecord(root.env) ? root.env : {}
    return {
      values: {
        authToken: text(env[keys.authToken]), baseUrl: text(env[keys.baseUrl]), model: text(env[keys.model]),
        autoCompact: !['1', 'true', 'yes', 'on'].includes(text(env[keys.disabled]).toLowerCase()),
        autoCompactThreshold: text(env[keys.threshold]), autoCompactWindow: text(env[keys.window]),
      },
      raw: JSON.stringify(root, null, 2), version: version(bytes), path: this.filePath,
    }
  }

  save(expected: string, values: Partial<ManagedClaudeSettings>) {
    const bytes = read(this.filePath)
    if (version(bytes) !== expected) throw new AppError('settings_conflict', 'settings.json 已被其他程序修改，请刷新后再保存', true)
    const root = parseRoot(bytes)
    const env = isRecord(root.env) ? root.env : (root.env = {})
    merge(env, keys.authToken, values.authToken); merge(env, keys.baseUrl, values.baseUrl); merge(env, keys.model, values.model)
    merge(env, keys.threshold, values.autoCompactThreshold); merge(env, keys.window, values.autoCompactWindow)
    if (values.autoCompact === true) delete env[keys.disabled]
    if (values.autoCompact === false) env[keys.disabled] = '1'
    return this.write(bytes, root)
  }

  saveRaw(expected: string, raw: string) {
    const bytes = read(this.filePath)
    if (version(bytes) !== expected) throw new AppError('settings_conflict', 'settings.json 已被其他程序修改，请刷新后再保存', true)
    return this.write(bytes, parseRoot(Buffer.from(raw)))
  }

  private write(previous: Buffer, root: Record<string, unknown>) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    if (previous.length) fs.copyFileSync(this.filePath, `${this.filePath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
    const temporary = path.join(path.dirname(this.filePath), `.settings.json.${randomUUID()}.tmp`)
    fs.writeFileSync(temporary, `${JSON.stringify(root, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, this.filePath)
    return this.load()
  }
}

function read(file: string) { try { return fs.readFileSync(file) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(0); throw error } }
function parseRoot(bytes: Buffer): Record<string, unknown> { if (!bytes.length) return {}; try { const value = JSON.parse(bytes.toString()); if (isRecord(value)) return value } catch (error) { throw new AppError('settings_invalid_json', `settings.json 不是有效 JSON：${String(error)}`, true) } throw new AppError('settings_invalid_root', 'settings.json 顶层必须是对象', true) }
function version(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex').slice(0, 16) }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function text(value: unknown) { return typeof value === 'string' ? value : '' }
function merge(target: Record<string, unknown>, key: string, value: string | undefined) { if (value === undefined) return; if (value.trim()) target[key] = value; else delete target[key] }
