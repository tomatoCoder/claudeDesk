import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { TaskEvent, TaskStatus } from '../../shared/contracts.js'
import { IPC_CHANNELS } from '../../shared/contracts.js'
import { AppError } from '../../shared/errors.js'
import { diagnoseClaude } from '../claude/locator.js'
import type { Storage } from '../database/storage.js'
import type { ClaudeSettingsRepository } from '../settings/claude-settings.js'
import { ActiveRun } from './active-run.js'
import { bridgeEventData, bridgeStatus } from './event-mapper.js'
import { TurnQueue } from './turn-queue.js'
import { PermissionCoordinator } from '../permissions/coordinator.js'
import type { ResolvePermissionInput } from '../permissions/contracts.js'
import type { LogStore } from '../diagnostics/log-store.js'

interface Running { worker: ActiveRun; taskId: string; sequence: number; stopping: boolean; finished: boolean }

export class TaskCoordinator {
  private readonly running = new Map<string, Running>()
  private readonly queued = new TurnQueue()
  private readonly adjustments = new Map<string, (accepted: boolean) => void>()
  private readonly permissions = new PermissionCoordinator()

  constructor(private readonly storage: Storage, private readonly settings: ClaudeSettingsRepository, private readonly window: BrowserWindow, private readonly logs: LogStore) {}

  async submit(taskId: string, prompt: string, queueWhenBusy = true) {
    const text = validatePrompt(prompt)
    if (this.running.has(taskId)) {
      if (!queueWhenBusy) throw new AppError('task_already_running', '该会话正在运行', true)
      const queuedTurn = this.queued.push(taskId, text); this.publishQueue(taskId)
      return { kind: 'queued' as const, queuedTurn }
    }
    return { kind: 'started' as const, runId: await this.start(taskId, text) }
  }

  private async start(taskId: string, prompt: string) {
    const task = this.storage.getTask(taskId); const project = this.storage.getProject(task.projectId)
    const diagnostic = await diagnoseClaude(this.storage.loadSettings().claudePath)
    if (diagnostic.status !== 'ready' || !diagnostic.path) throw new AppError('cli_not_ready', diagnostic.message, true)
    const runId = randomUUID()
    const current: Running = { worker: undefined as never, taskId, sequence: 0, stopping: false, finished: false }
    const worker = new ActiveRun(runId, task.projectId, (event) => this.handle(current, event), (error) => this.finish(current, error), (stream, value) => this.logs.append(taskId, stream, value))
    current.worker = worker; this.running.set(taskId, current)
    if (task.title === '新任务') { const title = prompt.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.replace(/\s+/g, ' ').slice(0, 30); if (title) this.emit('task-updated', this.storage.renameTask(taskId, title)) }
    this.storage.transitionTask(taskId, 'starting')
    this.publish(current, 'user_message', { text: prompt }); this.publishStatus(current, 'starting')
    const managed = this.settings.load().values; const appSettings = this.storage.loadSettings()
    worker.write({
      v: 1, type: 'run.start', requestId: randomUUID(), runId, claudePath: diagnostic.path, cwd: project.path, prompt,
      ...(task.claudeSessionId ? { sessionId: task.claudeSessionId } : managed.model ? { model: managed.model } : {}),
      ...(task.modelOverride ? { modelOverride: task.modelOverride } : {}),
      ...(task.permissionModeOverride ? { permissionMode: task.permissionModeOverride } : appSettings.permissionMode === 'auto' ? { permissionMode: 'auto' } : appSettings.permissionMode === 'bypass' ? { permissionMode: 'bypassPermissions' } : {}),
    })
    return runId
  }

  cancel(taskId: string) {
    const run = this.running.get(taskId); if (!run) throw new AppError('task_not_running', '该会话当前未运行', true)
    run.stopping = true; this.permissions.cancelTask(taskId); this.storage.transitionTask(taskId, 'stopping'); this.publishStatus(run, 'stopping'); run.worker.stop()
  }

  resolvePermission(input: ResolvePermissionInput) {
    const run = this.running.get(input.taskId)
    if (!run) throw new AppError('task_not_running', '该会话当前未运行', true)
    const decision = this.permissions.resolve(input)
    this.publish(run, 'permission_resolved', { requestId: input.requestId, decision })
    this.storage.transitionTask(input.taskId, 'running'); this.publishStatus(run, 'running')
  }

  listQueue(taskId: string) { this.storage.getTask(taskId); return this.queued.list(taskId) }
  updateQueue(taskId: string, id: string, prompt: string) { const turn = this.queued.update(taskId, id, validatePrompt(prompt)); if (!turn) throw new AppError('queued_turn_not_found', '等待消息不存在', true); this.publishQueue(taskId); return turn }
  deleteQueue(taskId: string, id: string) { if (!this.queued.remove(taskId, id)) throw new AppError('queued_turn_not_found', '等待消息不存在', true); this.publishQueue(taskId) }

  async adjustQueue(taskId: string, id: string) {
    const run = this.running.get(taskId); if (!run) throw new AppError('task_not_running', '该会话当前未运行', true)
    const claimed = this.queued.take(taskId, id); if (!claimed) throw new AppError('queued_turn_not_found', '等待消息不存在', true)
    const adjustmentId = randomUUID()
    const accepted = new Promise<boolean>((resolve) => this.adjustments.set(adjustmentId, resolve))
    run.worker.write({ v: 1, type: 'run.adjust', runId: run.worker.runId, adjustmentId, text: claimed.turn.text })
    const ok = await Promise.race([accepted, new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000))])
    this.adjustments.delete(adjustmentId)
    if (!ok) { this.queued.restore(taskId, claimed.index, claimed.turn); this.publishQueue(taskId); throw new AppError('adjustment_rejected', '调整方向被拒绝', true) }
    this.publish(run, 'user_message', { text: claimed.turn.text }); this.publishQueue(taskId)
  }

  async sendQueued(taskId: string, id: string) {
    if (this.running.has(taskId)) throw new AppError('task_already_running', '该会话正在运行', true)
    const claimed = this.queued.take(taskId, id); if (!claimed) throw new AppError('queued_turn_not_found', '等待消息不存在', true)
    try { const runId = await this.start(taskId, claimed.turn.text); this.publishQueue(taskId); return { runId } }
    catch (error) { this.queued.restore(taskId, claimed.index, claimed.turn); this.publishQueue(taskId); throw error }
  }

  activeTaskIds() { return [...this.running.keys()] }
  shutdown() { for (const run of this.running.values()) run.worker.stopImmediately() }

  private handle(run: Running, event: Record<string, unknown>) {
    if (event.runId && event.runId !== run.worker.runId) return
    if (event.type === 'run.adjust.accepted' || event.type === 'run.adjust.rejected') { const resolve = this.adjustments.get(String(event.adjustmentId)); resolve?.(event.type === 'run.adjust.accepted'); return }
    if (event.type === 'permission.requested' || event.type === 'question.requested') {
      const requestId = typeof event.permissionId === 'string' ? event.permissionId : ''
      if (!requestId) return this.finish(run, new AppError('bridge_permission_invalid', '权限事件缺少 permissionId', true))
      this.permissions.add({ taskId: run.taskId, runId: run.worker.runId, requestId, send: (control) => run.worker.write(control) })
      this.storage.transitionTask(run.taskId, 'awaiting_permission')
      if (event.type === 'question.requested') {
        const input = isRecord(event.input) ? event.input : {}
        this.publish(run, 'question_requested', { requestId, questions: Array.isArray(input.questions) ? input.questions : [] })
      } else {
        this.publish(run, 'permission_requested', { requestId, toolName: typeof event.toolName === 'string' ? event.toolName : 'Unknown', input: event.input ?? {}, suggestions: Array.isArray(event.suggestions) ? event.suggestions : [] })
      }
      this.publishStatus(run, 'awaiting_permission')
      return
    }
    if (event.type === 'session.started' && typeof event.sessionId === 'string') this.storage.updateTaskSession(run.taskId, event.sessionId)
    if (event.type === 'run.result' && typeof event.sessionId === 'string' && event.sessionId) this.storage.updateTaskSession(run.taskId, event.sessionId)
    if (event.type === 'run.status') {
      const status = bridgeStatus(event.status)
      if (['completed', 'interrupted', 'failed'].includes(status)) return this.finish(run, undefined, status)
      this.storage.transitionTask(run.taskId, status); this.publishStatus(run, status); return
    }
    const mapped = bridgeEventData(event); if (mapped) this.publish(run, mapped.kind, mapped.data)
    if (event.type === 'run.error') this.finish(run, undefined, 'failed')
  }

  private finish(run: Running, error?: AppError, status?: TaskStatus) {
    if (run.finished) return; run.finished = true
    const finalStatus = status || (run.stopping ? 'interrupted' : error ? 'failed' : 'completed')
    if (error) this.publish(run, 'error', { code: error.code, message: error.message, recoverable: error.recoverable })
    this.permissions.cancelTask(run.taskId); this.storage.transitionTask(run.taskId, finalStatus); this.publishStatus(run, finalStatus); this.running.delete(run.taskId)
    if (finalStatus === 'completed') void this.startNext(run.taskId)
  }

  private async startNext(taskId: string) { if (this.running.has(taskId)) return; const claimed = this.queued.takeFront(taskId); if (!claimed) return; try { await this.start(taskId, claimed.turn.text) } catch { this.queued.restore(taskId, claimed.index, claimed.turn) } this.publishQueue(taskId) }
  private publishStatus(run: Running, status: TaskStatus) { this.publish(run, 'status_changed', { status }) }
  private publish(run: Running, kind: string, data: Record<string, unknown>) { const event: TaskEvent = { version: 1, taskId: run.taskId, runId: run.worker.runId, sequence: ++run.sequence, createdAt: new Date().toISOString(), kind, data }; this.storage.appendEvent(event); this.emit('task-event', event) }
  private publishQueue(taskId: string) { this.emit('queued-turns-changed', { taskId, queuedTurns: this.queued.list(taskId) }) }
  private emit(name: Parameters<typeof IPC_CHANNELS.event>[0], payload: unknown) { if (!this.window.isDestroyed()) this.window.webContents.send(IPC_CHANNELS.event(name), payload) }
}

function validatePrompt(prompt: string) { const value = prompt.trim(); if (!value) throw new AppError('empty_prompt', '消息不能为空', true); if (value.length > 200_000) throw new AppError('prompt_too_large', '消息长度超过 200,000 个字符', true); return value }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
