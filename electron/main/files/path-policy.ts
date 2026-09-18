import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../../shared/errors.js'

export function projectRoot(value: string) { try { const root = fs.realpathSync(value); if (fs.statSync(root).isDirectory()) return root } catch {} throw new AppError('invalid_project_path', '项目目录不存在或不可访问', true) }
export function projectPath(rootValue: string, relative: string, allowRoot = false) {
  const root = projectRoot(rootValue)
  if ((!allowRoot && !relative) || path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => part === '..') || relative === '.git' || relative.startsWith('.git/') || relative.startsWith('.git\\')) throw outside()
  let target: string
  try { target = fs.realpathSync(path.join(root, relative)) } catch { throw new AppError('file_not_found', '文件或目录不存在', true) }
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw outside()
  return { root, target }
}
export function relativePath(root: string, target: string) { return path.relative(root, target).split(path.sep).join('/') }
function outside() { return new AppError('path_outside_project', '路径必须位于当前项目内', false) }
