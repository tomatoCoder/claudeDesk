import { describe, expect, it, vi } from 'vitest'
import { discoverCommandCatalog, normalizeCommandCatalog } from './commands.js'

describe('斜杠命令目录', () => {
  it('完整保留 CLI 返回的命令、别名和模型字段', () => {
    expect(normalizeCommandCatalog(
      [{ name: 'review', description: 'Review code', argumentHint: '<path>', aliases: ['rv'] }],
      [{ value: 'sonnet', displayName: 'Sonnet', description: 'Balanced', resolvedModel: 'claude-sonnet-5' }],
    )).toEqual({
      commands: [{ name: 'review', description: 'Review code', argumentHint: '<path>', aliases: ['rv'] }],
      models: [{ value: 'sonnet', displayName: 'Sonnet', description: 'Balanced', resolvedModel: 'claude-sonnet-5' }],
    })
  })

  it('丢弃空名称并把可选字段标准化为空值', () => {
    expect(normalizeCommandCatalog(
      [
        { name: '', description: 'invalid', argumentHint: '', aliases: [] },
        { name: 'help', description: '', argumentHint: '', aliases: undefined },
      ],
      [{ value: 'opus', displayName: 'Opus', description: '' }],
    )).toEqual({
      commands: [{ name: 'help', description: '', argumentHint: '', aliases: [] }],
      models: [{ value: 'opus', displayName: 'Opus', description: '', resolvedModel: null }],
    })
  })

  it('读取命令和模型后总是关闭临时 Query', async () => {
    const close = vi.fn()
    const createQuery = vi.fn(() => ({
      supportedCommands: () => Promise.resolve([{ name: 'help', description: 'Help', argumentHint: '', aliases: [] }]),
      supportedModels: () => Promise.resolve([{ value: 'sonnet', displayName: 'Sonnet', description: 'Balanced' }]),
      close,
    }))

    await expect(discoverCommandCatalog(
      { claudePath: '/usr/local/bin/claude', cwd: '/workspace' },
      createQuery as never,
    )).resolves.toMatchObject({ commands: [{ name: 'help' }], models: [{ value: 'sonnet' }] })
    expect(close).toHaveBeenCalledOnce()
  })

  it('读取目录失败时也关闭临时 Query', async () => {
    const close = vi.fn()
    const createQuery = () => ({
      supportedCommands: () => Promise.reject(new Error('init failed')),
      supportedModels: () => Promise.resolve([]),
      close,
    })

    await expect(discoverCommandCatalog(
      { claudePath: '/usr/local/bin/claude', cwd: '/workspace' },
      createQuery as never,
    )).rejects.toThrow('init failed')
    expect(close).toHaveBeenCalledOnce()
  })
})
