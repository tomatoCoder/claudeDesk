vi.mock('./ipc', () => ({
  ipc: { listSlashCommands: vi.fn() },
  errorMessage: (error: unknown) => String(error),
}))
import { describe, expect, it, vi } from 'vitest'
import { filterSlashCommands, invalidateSlashCommandCatalog, loadSlashCommandCatalog } from './slashCommands'
import { ipc } from './ipc'

const commands = [
  { name: 'review', description: 'Review code', argumentHint: '<path>', aliases: ['rv'] },
  { name: 'permissions', description: 'Manage permissions', argumentHint: '', aliases: [] },
  { name: 'inspect', description: '', argumentHint: '', aliases: ['review-all'] },
]

describe('slashCommands', () => {
  it('同一项目的并发加载共享同一个 Promise，失败后可重试', async () => {
    const mock = vi.mocked(ipc.listSlashCommands).mockResolvedValueOnce({ commands: [], models: [] })
    const first = loadSlashCommandCatalog('p1')
    expect(loadSlashCommandCatalog('p1')).toBe(first)
    await first
    expect(mock).toHaveBeenCalledTimes(1)

    vi.mocked(ipc.listSlashCommands).mockRejectedValueOnce(new Error('boom'))
    await expect(loadSlashCommandCatalog('p2')).rejects.toThrow('boom')
    vi.mocked(ipc.listSlashCommands).mockResolvedValueOnce({ commands: [], models: [] })
    await expect(loadSlashCommandCatalog('p2')).resolves.toBeDefined()
  })

  it('invalidate 后重新发起真实请求', async () => {
    const mock = vi.mocked(ipc.listSlashCommands).mockResolvedValue({ commands: [], models: [] })
    await loadSlashCommandCatalog('p3')
    invalidateSlashCommandCatalog('p3')
    await loadSlashCommandCatalog('p3')
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('名称前缀优先于别名前缀，忽略大小写', () => {
    const ranked = filterSlashCommands(commands, '/RE')
    expect(ranked.map((item) => item.command.name)).toEqual(['review', 'inspect'])
    expect(ranked[1].matchedAlias).toBe('review-all')
  })

  it('空查询返回全部命令', () => {
    expect(filterSlashCommands(commands, '/')).toHaveLength(3)
  })
})
