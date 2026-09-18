import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { AppError } from '../../shared/errors.js'
import { projectPath, projectRoot, relativePath } from './path-policy.js'

const MAX = 2 * 1024 * 1024
const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' }

export function listDirectory(rootValue: string, relative: string) {
  const { root, target } = projectPath(rootValue, relative, true)
  if (!fs.statSync(target).isDirectory()) throw new AppError('not_a_directory', '所选路径不是目录', true)
  return fs.readdirSync(target, { withFileTypes: true }).map((entry) => entryDto(root, path.join(target, entry.name), entry.isDirectory())).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.kind === 'directory' ? -1 : 1))
}

export function readPreview(rootValue: string, relative: string) {
  const { root, target } = projectPath(rootValue, relative)
  const stat = fs.statSync(target); if (!stat.isFile()) throw new AppError('not_a_file', '所选路径不是文件', true)
  const result = { path: relativePath(root, target), mimeType: mime(target), content: null as string | null, bytes: null as number[] | null, size: stat.size }
  if (stat.size > MAX) return { ...result, kind: 'too_large' }
  const bytes = fs.readFileSync(target)
  if (result.mimeType) return { ...result, kind: 'image', bytes: [...bytes] }
  if (bytes.includes(0)) return { ...result, kind: 'binary', mimeType: null }
  try { return { ...result, kind: 'text', mimeType: 'text/plain', content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) } } catch { return { ...result, kind: 'binary', mimeType: null } }
}

export function writeText(rootValue: string, relative: string, content: string) { const preview = readPreview(rootValue, relative); if (preview.kind !== 'text') throw new AppError('file_not_editable', '仅支持编辑文本文件', true); fs.writeFileSync(projectPath(rootValue, relative).target, content) }

export function searchFiles(rootValue: string, queryValue: string, limitValue: number) {
  const root = projectRoot(rootValue); const query = queryValue.trim().toLowerCase(); if (!query) return []
  let files: string[]
  try { files = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { maxBuffer: 10 * 1024 * 1024 }).toString().split('\0').filter(Boolean) }
  catch { files = walk(root).map((target) => relativePath(root, target)) }
  return files.filter((relative) => relative.toLowerCase().includes(query) || contentContains(root, relative, query)).slice(0, Math.max(1, Math.min(200, limitValue || 200))).map((relative) => entryDto(root, projectPath(root, relative).target, false))
}

function walk(root: string) { const result: string[] = []; const pending = [root]; while (pending.length && result.length < 50_000) { const dir = pending.pop()!; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { if (['.git', 'node_modules', 'target', 'dist'].includes(entry.name)) continue; const target = path.join(dir, entry.name); if (entry.isDirectory()) pending.push(target); else if (entry.isFile()) result.push(target) } } return result }
function contentContains(root: string, relative: string, query: string) { try { const target = projectPath(root, relative).target; const stat = fs.statSync(target); if (stat.size > MAX || mime(target)) return false; const bytes = fs.readFileSync(target); return !bytes.includes(0) && bytes.toString('utf8').toLowerCase().includes(query) } catch { return false } }
function entryDto(root: string, target: string, directory: boolean) { const name = path.basename(target); return { name, path: relativePath(root, target), kind: directory ? 'directory' : 'file', extension: directory ? null : path.extname(name).slice(1).toLowerCase() || null } }
function mime(target: string) { return imageTypes[path.extname(target).slice(1).toLowerCase()] || null }
