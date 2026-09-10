import { describe, expect, it } from 'vitest'
import { sessionMessagesToEvents } from './sessionMessages'

describe('Claude 历史消息转换', () => {
  it('把用户与助手内容转换为现有时间线事件', () => {
    const events = sessionMessagesToEvents('task-1', [
      { type: 'user', uuid: 'u1', sessionId: 's1', message: { content: '你好' } },
      { type: 'assistant', uuid: 'a1', sessionId: 's1', message: { content: [{ type: 'text', text: '欢迎' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } }] } },
    ])

    expect(events.map((event) => event.kind)).toEqual(['user_message', 'assistant_message', 'tool_started'])
    expect(events[1]).toMatchObject({ data: { messageId: 'a1', markdown: '欢迎' } })
  })
})
