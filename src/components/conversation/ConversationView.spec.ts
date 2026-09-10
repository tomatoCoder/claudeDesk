// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { TaskEvent } from '../../domain/events'
import ConversationView from './ConversationView.vue'

const task = {
  id: 'task-1',
  projectId: 'project-1',
  title: '新任务',
  claudeSessionId: 'session-1',
  status: 'completed' as const,
  createdAt: '2026-09-10T00:00:00Z',
  updatedAt: '2026-09-10T00:00:00Z',
}

function event<K extends TaskEvent['kind']>(sequence: number, kind: K, data: Extract<TaskEvent, { kind: K }>['data']): TaskEvent {
  return {
    version: 1,
    taskId: task.id,
    runId: 'run-1',
    sequence,
    createdAt: '2026-09-10T00:00:00Z',
    kind,
    data,
  } as TaskEvent
}

describe('ConversationView', () => {
  it('把同一轮的流式片段与最终消息合并为一条助手回复', () => {
    const events = [
      event(1, 'user_message', { text: 'Hello' }),
      event(2, 'assistant_delta', { messageId: 'delta-1', text: 'Hel' }),
      event(3, 'assistant_delta', { messageId: 'delta-2', text: 'lo' }),
      event(4, 'assistant_message', { messageId: 'final-1', markdown: 'Hello' }),
    ]
    const wrapper = mount(ConversationView, { props: { task, events, cliReady: true } })

    const replies = wrapper.findAll('.message.assistant')
    expect(replies).toHaveLength(1)
    expect(replies[0].text()).toBe('Hello')
  })
})
