import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../shared/errors.js'
import { app } from 'electron'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

export async function bridgeRequest(payload: Record<string, unknown>) {
  const script = process.env.CLAUDE_DESK_BRIDGE_PATH || (app.isPackaged ? path.join(process.resourcesPath, 'bridge/dist/main.js') : path.join(currentDirectory, '../../../bridge/dist/main.js'))
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new AppError('bridge_timeout', 'Agent Bridge 请求超时', true))
    }, 15_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (Buffer.byteLength(stdout) > MAX_RESPONSE_BYTES) {
        child.kill()
        reject(new AppError('bridge_response_too_large', 'Bridge 响应超过 4 MiB', false))
      }
    })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => { clearTimeout(timer); reject(new AppError('bridge_spawn_failed', error.message, true)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const line = stdout.split('\n').find((value) => value.trim())
      if (!line) return reject(new AppError('bridge_exit_error', redact(stderr || `Agent Bridge 异常退出（状态码 ${code ?? '未知'}）`), true))
      try {
        const event = JSON.parse(line) as Record<string, unknown>
        if (event.v !== 1) throw new AppError('bridge_protocol_version', 'Bridge 协议版本不兼容', false)
        if (event.type === 'bridge.error') throw new AppError(String(event.code || 'bridge_error'), redact(String(event.message || 'Agent Bridge 执行失败')), event.recoverable !== false)
        resolve(event)
      } catch (error) {
        reject(error instanceof AppError ? error : new AppError('bridge_invalid_json', 'Bridge 返回无效 JSON', true))
      }
    })
    child.stdin.end(`${JSON.stringify({ v: 1, requestId: randomUUID(), ...payload })}\n`)
  })
}

function redact(value: string) {
  return value.replace(/(ANTHROPIC_AUTH_TOKEN[=:]\s*)\S+/gi, '$1[REDACTED]').replace(/(?:sk-ant|sk)-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
}
