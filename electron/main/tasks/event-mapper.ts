import type { TaskStatus } from '../../shared/contracts.js'

const statuses = new Set<TaskStatus>(['idle', 'starting', 'running', 'awaiting_permission', 'stopping', 'completed', 'interrupted', 'failed'])

export function bridgeEventData(event: Record<string, unknown>): { kind: string; data: Record<string, unknown> } | undefined {
  const type = String(event.type || '')
  if (type === 'assistant.delta') return item('assistant_delta', event, ['messageId', 'text'])
  if (type === 'assistant.message') return item('assistant_message', event, ['messageId', 'markdown'])
  if (type === 'tool.started') return item('tool_started', event, ['toolUseId', 'toolName', 'input'])
  if (type === 'tool.finished') return item('tool_finished', event, ['toolUseId', 'output', 'isError'])
  if (type === 'local_command_output') return item('local_command_output', event, ['content'])
  if (type === 'run.result') return item('result', event, ['sessionId', 'costUsd', 'turns'])
  if (type === 'run.error') return item('error', { ...event, code: event.code || 'sdk_query_failed', message: event.message || 'Agent Bridge 执行失败', recoverable: event.recoverable !== false }, ['code', 'message', 'recoverable'])
  return undefined
}

export function bridgeStatus(value: unknown): TaskStatus { return statuses.has(value as TaskStatus) ? value as TaskStatus : 'idle' }
function item(kind: string, source: Record<string, unknown>, keys: string[]) { return { kind, data: Object.fromEntries(keys.map((key) => [key, source[key] ?? null])) } }
