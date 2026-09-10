import { describe, expect, it } from 'vitest'
import { buildQueryOptions, normalizeSdkMessage } from './agent-adapter.js'

describe('Agent SDK 适配器', () => {
  it('新会话使用当前模型和本机 Claude 可执行文件', () => {
    expect(buildQueryOptions({ claudePath: '/usr/local/bin/claude', cwd: '/workspace', model: 'gateway-sonnet' }))
      .toMatchObject({ cwd: '/workspace', model: 'gateway-sonnet', pathToClaudeCodeExecutable: '/usr/local/bin/claude' })
  })

  it('恢复会话不覆盖原模型', () => {
    const options = buildQueryOptions({ claudePath: '/usr/local/bin/claude', cwd: '/workspace', model: 'new-model', sessionId: 'session-1' })
    expect(options).toMatchObject({ resume: 'session-1' })
    expect(options).not.toHaveProperty('model')
  })

  it('把初始化和流式文本转换为稳定的小型事件', () => {
    expect(normalizeSdkMessage({ type: 'system', subtype: 'init', session_id: 'session-1' })).toEqual([
      { type: 'session.started', sessionId: 'session-1' },
    ])
    expect(normalizeSdkMessage({ type: 'stream_event', uuid: 'm1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } } })).toEqual([
      { type: 'assistant.delta', messageId: 'm1', text: '你好' },
    ])
  })

  it('保留工具调用与结果，但不泄露整个 SDK 消息', () => {
    expect(normalizeSdkMessage({
      type: 'assistant', uuid: 'm2', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/tmp/a' } }] },
    })).toEqual([{ type: 'tool.started', toolUseId: 't1', toolName: 'Read', input: { file_path: '/tmp/a' } }])
  })
})
