import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../../shared/errors.js'

const MAX_BYTES = 5 * 1024 * 1024
export class LogStore {
  constructor(private readonly root: string) { fs.mkdirSync(root, { recursive: true }) }
  append(taskId: string, stream: string, value: string) {
    validateId(taskId)
    const target = path.join(this.root, `${taskId}.log`)
    const previous = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0)
    const next = Buffer.from(`${previous.toString()}[${stream}] ${redact(value)}${value.endsWith('\n') ? '' : '\n'}`)
    fs.writeFileSync(target, next.length > MAX_BYTES ? next.subarray(next.length - MAX_BYTES) : next)
  }
  read(taskId: string) { validateId(taskId); const target = path.join(this.root, `${taskId}.log`); if (!fs.existsSync(target)) return ''; const bytes = fs.readFileSync(target); return bytes.subarray(Math.max(0, bytes.length - MAX_BYTES)).toString('utf8') }
}
function validateId(value: string) { if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) throw new AppError('invalid_identifier', '无效的任务标识', false) }
function redact(value: string) { return value.replace(/(ANTHROPIC_AUTH_TOKEN[=:]\s*)\S+/gi, '$1[REDACTED]').replace(/(?:sk-ant|sk)-[A-Za-z0-9_-]{12,}/g, '[REDACTED]') }
