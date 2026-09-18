import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const MAX_PATCH = 2 * 1024 * 1024
export function workspaceDiff(directory: string) {
  if (!fs.statSync(directory).isDirectory()) throw new Error('项目目录不可访问')
  try { git(directory, ['rev-parse', '--is-inside-work-tree']) } catch { return { isRepository: false, branch: null, files: [], patch: '', truncated: false } }
  const branch = git(directory, ['branch', '--show-current']).trim() || null
  const status = git(directory, ['status', '--porcelain=v1', '-z'])
  const files = status.split('\0').filter((entry) => entry.length >= 4).map((entry) => ({ path: entry.slice(3), status: entry.slice(0, 2).trim(), staged: ![' ', '?'].includes(entry[0]) }))
  let patch = git(directory, ['diff', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'])
  const staged = git(directory, ['diff', '--cached', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'])
  if (staged) patch += `\n# Staged changes\n${staged}`
  const truncated = Buffer.byteLength(patch) > MAX_PATCH
  if (truncated) patch = `${Buffer.from(patch).subarray(0, MAX_PATCH).toString()}\n\n… diff 已截断 …\n`
  return { isRepository: true, branch, files, patch, truncated }
}
function git(cwd: string, args: string[]) { return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }) }
