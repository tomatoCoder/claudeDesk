import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CliDiagnosticDto } from '../../shared/contracts.js'

const execFileAsync = promisify(execFile)
const MINIMUM_VERSION = [2, 1, 223] as const

export function claudeCandidates(custom?: string | null) {
  const home = os.homedir()
  const executable = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const values = [
    custom?.trim(),
    ...String(process.env.PATH || '').split(path.delimiter).map((directory) => path.join(directory, executable)),
    path.join(home, '.local', 'bin', executable),
    path.join(home, '.claude', 'local', executable),
    ...(process.platform === 'darwin' ? ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'] : []),
    ...(process.platform === 'win32' ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe')] : []),
    ...nvmCandidates(home, executable),
  ].filter((value): value is string => !!value && path.isAbsolute(value))
  return [...new Set(values)]
}

export async function diagnoseClaude(custom?: string | null): Promise<CliDiagnosticDto> {
  const executable = claudeCandidates(custom).find(isFile)
  if (!executable) return { status: 'not_found', path: null, version: null, message: '未找到 Claude Code CLI，请先安装并登录' }
  try {
    const { stdout } = await execFileAsync(executable, ['--version'], { timeout: 3_000, windowsHide: true, maxBuffer: 1024 * 1024 })
    const version = parseVersion(stdout)
    if (compareVersion(version, MINIMUM_VERSION) < 0) {
      return { status: 'too_old', path: executable, version: version.join('.'), message: `Claude Code 版本过旧，需要至少 ${MINIMUM_VERSION.join('.')}` }
    }
    return { status: 'ready', path: executable, version: version.join('.'), message: 'Claude Code 可执行文件已就绪' }
  } catch {
    return { status: 'probe_failed', path: executable, version: null, message: 'Claude Code 版本检查失败' }
  }
}

function nvmCandidates(home: string, executable: string) {
  const root = path.join(home, '.nvm', 'versions', 'node')
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, 'bin', executable))
      .sort().reverse()
  } catch { return [] }
}

function isFile(value: string) {
  try { return fs.statSync(value).isFile() } catch { return false }
}

function parseVersion(output: string): [number, number, number] {
  const match = output.match(/\bv?(\d+)\.(\d+)\.(\d+)\b/)
  if (!match) throw new Error('无法解析 Claude Code 版本')
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersion(left: readonly number[], right: readonly number[]) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}
