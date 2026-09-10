import type { Options } from '@anthropic-ai/claude-agent-sdk'

export interface QueryContext {
  claudePath: string
  cwd: string
  sessionId?: string
  model?: string
}

export type NormalizedAgentEvent =
  | { type: 'session.started'; sessionId: string }
  | { type: 'assistant.delta'; messageId: string; text: string }
  | { type: 'assistant.message'; messageId: string; markdown: string }
  | { type: 'tool.started'; toolUseId: string; toolName: string; input: unknown }
  | { type: 'tool.finished'; toolUseId: string; output: unknown; isError: boolean }
  | { type: 'run.result'; sessionId: string; costUsd: number | null; turns: number | null; subtype?: string }
  | { type: 'run.retry'; attempt: number; message: string }

export function buildQueryOptions(context: QueryContext): Options {
  const options: Options = {
    cwd: context.cwd,
    pathToClaudeCodeExecutable: context.claudePath,
    includePartialMessages: true,
    permissionMode: 'default',
    settingSources: ['user', 'project', 'local'],
  }
  if (context.sessionId) options.resume = context.sessionId
  else if (context.model?.trim()) options.model = context.model.trim()
  return options
}

export function normalizeSdkMessage(message: unknown): NormalizedAgentEvent[] {
  if (!isRecord(message)) return []
  const type = asString(message.type)
  if (type === 'system' && message.subtype === 'init') {
    const sessionId = asString(message.session_id)
    return sessionId ? [{ type: 'session.started', sessionId }] : []
  }
  if (type === 'system' && message.subtype === 'api_retry') {
    return [{ type: 'run.retry', attempt: asNumber(message.attempt) ?? 0, message: errorText(message.error) }]
  }
  if (type === 'stream_event' && isRecord(message.event)) {
    const event = message.event
    if (event.type === 'content_block_delta' && isRecord(event.delta) && event.delta.type === 'text_delta') {
      const text = asString(event.delta.text)
      if (text) return [{ type: 'assistant.delta', messageId: asString(message.uuid) || 'assistant', text }]
    }
    return []
  }
  if (type === 'assistant' && isRecord(message.message) && Array.isArray(message.message.content)) {
    const events: NormalizedAgentEvent[] = []
    let markdown = ''
    for (const block of message.message.content) {
      if (!isRecord(block)) continue
      if (block.type === 'text') markdown += asString(block.text)
      if (block.type === 'tool_use') {
        events.push({
          type: 'tool.started',
          toolUseId: asString(block.id),
          toolName: asString(block.name) || 'Tool',
          input: block.input ?? null,
        })
      }
    }
    if (markdown) events.push({ type: 'assistant.message', messageId: asString(message.uuid) || 'assistant', markdown })
    return events
  }
  if (type === 'user' && isRecord(message.message) && Array.isArray(message.message.content)) {
    return message.message.content.flatMap((block): NormalizedAgentEvent[] => {
      if (!isRecord(block) || block.type !== 'tool_result') return []
      return [{
        type: 'tool.finished',
        toolUseId: asString(block.tool_use_id),
        output: block.content ?? null,
        isError: block.is_error === true,
      }]
    })
  }
  if (type === 'result') {
    return [{
      type: 'run.result',
      sessionId: asString(message.session_id),
      costUsd: asNumber(message.total_cost_usd),
      turns: asNumber(message.num_turns),
      subtype: asString(message.subtype) || undefined,
    }]
  }
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function errorText(value: unknown): string {
  if (typeof value === 'string') return value
  if (isRecord(value)) return asString(value.message) || asString(value.code) || 'Claude API 正在重试'
  return 'Claude API 正在重试'
}
