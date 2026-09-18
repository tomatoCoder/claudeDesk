import os from 'node:os'
import path from 'node:path'
import { AppError } from '../../shared/errors.js'
import type { Storage } from '../database/storage.js'
import { registerCommand } from '../ipc.js'
import { saveClipboardFile } from './clipboard.js'
import { listDirectory, readPreview, searchFiles, writeText } from './service.js'

export function registerFileCommands(storage: Storage) {
  const root = (id: unknown) => storage.getProject(text(id)).path
  registerCommand('list_project_directory', ({ projectId, path }) => listDirectory(root(projectId), text(path, true)))
  registerCommand('search_project_files', ({ projectId, query, limit }) => searchFiles(root(projectId), text(query, true), typeof limit === 'number' ? limit : 200))
  registerCommand('read_project_file', ({ projectId, path }) => readPreview(root(projectId), text(path)))
  registerCommand('write_project_file', ({ projectId, path, content }) => writeText(root(projectId), text(path), text(content, true)))
  registerCommand('save_clipboard_file', ({ name, mimeType, bytes }) => saveClipboardFile(path.join(os.tmpdir(), 'claude-desk'), text(name), text(mimeType, true), bytes))
  registerCommand('read_drag_file_paths', () => [])
}
function text(value: unknown, empty = false) { if (typeof value !== 'string' || (!empty && !value)) throw new AppError('invalid_argument', '参数格式无效', true); return value }
