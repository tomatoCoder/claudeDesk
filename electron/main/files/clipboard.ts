import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../shared/errors.js'

const mimeExtensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/tiff': 'tiff', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'text/plain': 'txt' }
export function saveClipboardFile(cacheRoot: string, name: string, mimeType: string, value: unknown) {
  if (!Array.isArray(value) || !value.length || !value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw new AppError('empty_clipboard_file', '剪贴板文件内容为空', true)
  const directory = path.join(cacheRoot, 'clipboard'); fs.mkdirSync(directory, { recursive: true })
  const parsed = path.parse(path.basename(name || 'pasted-file')); const stem = (parsed.name.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 80).replace(/^_+|_+$/g, '') || 'pasted-file')
  const supplied = parsed.ext.slice(1).toLowerCase(); const extension = /^[a-z0-9]{1,12}$/.test(supplied) ? supplied : mimeExtensions[mimeType.toLowerCase()]
  const target = path.join(directory, `${stem}-${randomUUID()}${extension ? `.${extension}` : ''}`); fs.writeFileSync(target, Buffer.from(value)); return target
}
