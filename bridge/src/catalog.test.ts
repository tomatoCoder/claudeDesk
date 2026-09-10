import { describe, expect, it } from 'vitest'
import { normalizeSession, normalizeSessionMessage } from './catalog.js'

describe('会话目录适配', () => {
  it('优先使用自定义标题并保留项目 cwd', () => {
    expect(normalizeSession({
      sessionId: 's1', summary: '自动摘要', customTitle: '我的会话', lastModified: 42, cwd: '/work/project',
    })).toEqual({
      sessionId: 's1', title: '我的会话', lastModified: 42, cwd: '/work/project', gitBranch: null, createdAt: null, fileSize: null,
    })
  })

  it('只暴露消息视图需要的稳定字段', () => {
    expect(normalizeSessionMessage({
      type: 'assistant', uuid: 'm1', session_id: 's1', parent_tool_use_id: null, parent_agent_id: null,
      message: { role: 'assistant', content: [{ type: 'text', text: '你好' }] },
    })).toEqual({ type: 'assistant', uuid: 'm1', sessionId: 's1', message: { role: 'assistant', content: [{ type: 'text', text: '你好' }] } })
  })
})
