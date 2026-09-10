import type { TaskEvent, TaskEventData } from '../domain/events'
import type { ClaudeSessionMessage } from '../domain/models'

export function sessionMessagesToEvents(taskId: string, messages: ClaudeSessionMessage[]): TaskEvent[] {
  const events: TaskEvent[] = []
  let sequence = 0
  for (const entry of messages) {
    if (!isRecord(entry.message)) continue
    const content = entry.message.content
    if (entry.type === 'user') {
      const text = textContent(content)
      if (text) events.push(event(taskId, ++sequence, { kind: 'user_message', text }))
      for (const block of blocks(content).filter((item) => item.type === 'tool_result')) {
        events.push(event(taskId, ++sequence, {
          kind: 'tool_finished',
          toolUseId: string(block.tool_use_id),
          output: block.content ?? null,
          isError: block.is_error === true,
        }))
      }
    }
    if (entry.type === 'assistant') {
      const text = textContent(content)
      if (text) events.push(event(taskId, ++sequence, { kind: 'assistant_message', messageId: entry.uuid, markdown: text }))
      for (const block of blocks(content).filter((item) => item.type === 'tool_use')) {
        events.push(event(taskId, ++sequence, {
          kind: 'tool_started',
          toolUseId: string(block.id),
          toolName: string(block.name) || 'Tool',
          input: block.input ?? null,
        }))
      }
    }
  }
  return events
}

function event(taskId: string, sequence: number, data: TaskEventData): TaskEvent {
  return {
    version: 1,
    taskId,
    runId: 'history',
    sequence,
    createdAt: '',
    kind: data.kind,
    data: Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'kind')),
  } as TaskEvent
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  return blocks(value).filter((block) => block.type === 'text').map((block) => string(block.text)).join('')
}

function blocks(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
