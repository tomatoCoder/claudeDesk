import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppError } from '../../shared/errors.js'
import { app } from 'electron'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

export class ActiveRun {
  readonly child: ChildProcessWithoutNullStreams
  private buffer = ''
  private stderr = ''

  constructor(
    readonly runId: string,
    readonly projectId: string,
    onEvent: (event: Record<string, unknown>) => void,
    onExit: (error?: AppError) => void,
    onLog?: (stream: 'stdout' | 'stderr', value: string) => void,
  ) {
    const script = process.env.CLAUDE_DESK_BRIDGE_PATH || (app.isPackaged ? path.join(process.resourcesPath, 'bridge/dist/main.js') : path.join(currentDirectory, '../../../bridge/dist/main.js'))
    this.child = spawn(process.execPath, [script], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    })
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => {
      onLog?.('stdout', chunk)
      this.buffer += chunk
      if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) return this.stopImmediately()
      let index: number
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index).trim(); this.buffer = this.buffer.slice(index + 1)
        if (!line) continue
        try { onEvent(JSON.parse(line) as Record<string, unknown>) } catch { onExit(new AppError('bridge_invalid_json', 'Bridge 返回无效 JSON', true)) }
      }
    })
    this.child.stderr.on('data', (chunk: string) => { onLog?.('stderr', chunk); this.stderr = `${this.stderr}${chunk}`.slice(-65_536) })
    this.child.on('error', (error) => onExit(new AppError('bridge_process_error', error.message, true)))
    this.child.on('close', (code) => onExit(code && code !== 0 ? new AppError('bridge_exit_error', this.stderr || `Agent Bridge 异常退出（状态码 ${code}）`, true) : undefined))
  }

  write(value: Record<string, unknown>) { if (!this.child.stdin.writable) throw new AppError('run_finished', '当前任务已经结束', true); this.child.stdin.write(`${JSON.stringify(value)}\n`) }
  stop() { this.write({ v: 1, type: 'run.stop', runId: this.runId }); setTimeout(() => this.stopImmediately(), 2_000).unref() }
  stopImmediately() {
    if (this.child.killed || !this.child.pid) return
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      try { process.kill(-this.child.pid, 'SIGTERM') } catch { this.child.kill() }
    }
  }
}
