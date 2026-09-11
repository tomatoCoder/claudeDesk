#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import {
  getSessionMessages,
  listSessions,
  query,
  renameSession,
  type CanUseTool,
  type PermissionResult,
} from '@anthropic-ai/claude-agent-sdk'
import { buildQueryOptions, normalizeSdkMessage } from './agent-adapter.js'
import { normalizeSession, normalizeSessionMessage } from './catalog.js'
import { parseBridgeRequest, parseRunControl, serializeBridgeEvent, type BridgeEvent, type BridgeRequest, type RunStartRequest } from './protocol.js'
import { applyRunControl, RunInput } from './run-input.js'

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
const lines = input[Symbol.asyncIterator]()

void start().catch((error) => {
  input.close()
  process.stdin.destroy()
  process.stdout.end(serializeBridgeEvent({ v: 1, type: 'bridge.error', requestId: 'unknown', code: 'BRIDGE_FATAL', message: redact(errorMessage(error)), recoverable: false }))
  process.exitCode = 1
})

async function start() {
  const first = await lines.next()
  if (first.done) throw new Error('Bridge 未收到请求')
  const request = parseBridgeRequest(first.value)
  if (request.type === 'handshake') {
    write({ v: 1, type: 'handshake.result', requestId: request.requestId, ok: true, protocolVersion: 1 })
    finishOneShot()
    return
  }
  if (request.type === 'catalog.list' || request.type === 'catalog.messages' || request.type === 'catalog.rename') {
    await handleCatalog(request)
    finishOneShot()
    return
  }
  if (request.type !== 'run.start') throw new Error(`不支持的 Bridge 请求：${request.type}`)
  await handleRun(request as RunStartRequest)
}

async function handleCatalog(request: Extract<BridgeRequest, { type: `catalog.${string}` }>) {
  if (request.type === 'catalog.list') {
    const sessions = await listSessions({ dir: request.cwd, limit: 1000, includeWorktrees: true })
    write({ v: 1, type: 'catalog.result', requestId: request.requestId, sessions: sessions.map(normalizeSession) })
    return
  }
  if (!request.sessionId) throw new Error('会话请求缺少 sessionId')
  if (request.type === 'catalog.messages') {
    const messages = await getSessionMessages(request.sessionId, { dir: request.cwd, limit: 5000 })
    write({ v: 1, type: 'catalog.messages.result', requestId: request.requestId, messages: messages.map(normalizeSessionMessage) })
    return
  }
  if (!request.title?.trim()) throw new Error('会话标题不能为空')
  await renameSession(request.sessionId, request.title.trim(), { dir: request.cwd })
  write({ v: 1, type: 'catalog.rename.result', requestId: request.requestId, ok: true })
}

async function handleRun(request: RunStartRequest) {
  let sequence = 0
  const nextSequence = () => ++sequence
  const abortController = new AbortController()
  const pending = new Map<string, (decision: PermissionResult) => void>()
  const runInput = new RunInput(request.prompt, randomUUID())
  const canUseTool: CanUseTool = (toolName, input, context) => new Promise((resolve) => {
    const permissionId = randomUUID()
    pending.set(permissionId, resolve)
    const type = toolName === 'AskUserQuestion' ? 'question.requested' : 'permission.requested'
    write({
      v: 1,
      type,
      requestId: request.requestId,
      runId: request.runId,
      sequence: nextSequence(),
      permissionId,
      toolName,
      input,
      suggestions: context.suggestions ?? [],
      title: context.title,
      description: context.description,
    })
    context.signal.addEventListener('abort', () => {
      if (!pending.delete(permissionId)) return
      resolve({ behavior: 'deny', message: '权限请求已取消' })
    }, { once: true })
  })

  const controlPump = consumeControls(request, pending, abortController, runInput, nextSequence)
  write({ v: 1, type: 'run.status', requestId: request.requestId, runId: request.runId, sequence: nextSequence(), status: 'running' })
  try {
    const options = buildQueryOptions(request)
    options.abortController = abortController
    options.canUseTool = canUseTool
    const stream = query({ prompt: runInput, options })
    for await (const sdkMessage of stream) {
      for (const event of normalizeSdkMessage(sdkMessage)) {
        write({ v: 1, ...event, requestId: request.requestId, runId: request.runId, sequence: nextSequence() })
      }
      if (isRecord(sdkMessage) && sdkMessage.type === 'result') runInput.close()
    }
    write({ v: 1, type: 'run.status', requestId: request.requestId, runId: request.runId, sequence: nextSequence(), status: abortController.signal.aborted ? 'interrupted' : 'completed' })
  } catch (error) {
    write({ v: 1, type: 'run.error', requestId: request.requestId, runId: request.runId, sequence: nextSequence(), code: abortController.signal.aborted ? 'RUN_STOPPED' : 'SDK_QUERY_FAILED', message: redact(errorMessage(error)), recoverable: true })
  } finally {
    for (const resolve of pending.values()) resolve({ behavior: 'deny', message: 'Bridge 已结束' })
    pending.clear()
    runInput.close()
    input.close()
    process.stdin.destroy()
    await controlPump
    process.stdout.end()
  }
}

async function consumeControls(
  request: RunStartRequest,
  pending: Map<string, (decision: PermissionResult) => void>,
  abortController: AbortController,
  runInput: RunInput,
  nextSequence: () => number,
) {
  for await (const line of { [Symbol.asyncIterator]: () => lines }) {
    let control
    try { control = parseRunControl(line) } catch { continue }
    if (control.runId !== request.runId) continue
    if (control.type === 'run.adjust') {
      const result = applyRunControl(runInput, control)
      write({
        v: 1,
        ...result,
        requestId: request.requestId,
        runId: request.runId,
        sequence: nextSequence(),
      })
      continue
    }
    if (control.type === 'run.stop') {
      runInput.close()
      abortController.abort()
      continue
    }
    const resolve = pending.get(control.permissionId)
    if (!resolve) continue
    pending.delete(control.permissionId)
    if (control.behavior === 'allow') {
      resolve({
        behavior: 'allow',
        updatedInput: isRecord(control.updatedInput) ? control.updatedInput : undefined,
        updatedPermissions: Array.isArray(control.updatedPermissions) ? control.updatedPermissions as never[] : undefined,
      })
    } else {
      resolve({ behavior: 'deny', message: typeof control.message === 'string' ? control.message : '用户拒绝了此操作' })
    }
  }
  runInput.close()
  abortController.abort()
}

function write(event: BridgeEvent) {
  process.stdout.write(serializeBridgeEvent(event))
}

function finishOneShot() {
  input.close()
  process.stdin.destroy()
  process.stdout.end()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function redact(value: string): string {
  return value
    .replace(/(ANTHROPIC_AUTH_TOKEN[=:]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/(?:sk-ant|sk)-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
