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

  it('把 CLI 本地命令输出转换为可展示事件', () => {
    expect(normalizeSdkMessage({
      type: 'system', subtype: 'local_command_output', content: 'Available commands', uuid: 'm3', session_id: 's1',
    })).toEqual([{ type: 'local_command_output', content: 'Available commands' }])
  })

  it('把动态命令变化转换为完整替换目录', () => {
    expect(normalizeSdkMessage({
      type: 'system', subtype: 'commands_changed', uuid: 'm4', session_id: 's1',
      commands: [{ name: 'review', description: 'Review code', argumentHint: '<path>', aliases: ['rv'] }],
    })).toEqual([{
      type: 'commands.changed',
      commands: [{ name: 'review', description: 'Review code', argumentHint: '<path>', aliases: ['rv'] }],
    }])
  })

  it('显式选择模型和权限模式时会应用到恢复会话', () => {
    expect(buildQueryOptions({
      claudePath: '/usr/local/bin/claude', cwd: '/workspace', sessionId: 'session-1', modelOverride: 'sonnet', permissionMode: 'plan',
    })).toMatchObject({ resume: 'session-1', model: 'sonnet', permissionMode: 'plan' })
  })
})
