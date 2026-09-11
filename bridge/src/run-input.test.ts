import { describe, expect, it } from 'vitest'
import { RunInput } from './run-input.js'

describe('RunInput', () => {
  it('先输出初始消息，再按 FIFO 输出立即调整消息', async () => {
    const input = new RunInput('先检查项目', '00000000-0000-4000-8000-000000000001')
    const iterator = input[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toMatchObject({ message: { content: '先检查项目' } })
    expect(input.adjust('立即改为只写测试', '00000000-0000-4000-8000-000000000002')).toBe(true)
    expect((await iterator.next()).value).toMatchObject({
      message: { content: '立即改为只写测试' }, priority: 'now', uuid: '00000000-0000-4000-8000-000000000002',
    })
  })

  it('关闭后拒绝新调整并结束迭代', async () => {
    const input = new RunInput('开始', '00000000-0000-4000-8000-000000000001')
    const iterator = input[Symbol.asyncIterator]()
    await iterator.next()
    input.close()
    expect(input.adjust('太晚了', '00000000-0000-4000-8000-000000000002')).toBe(false)
    expect(await iterator.next()).toEqual({ value: undefined, done: true })
  })

  it('关闭后仍排空关闭前缓冲的调整消息', async () => {
    const input = new RunInput('开始', '00000000-0000-4000-8000-000000000001')
    const iterator = input[Symbol.asyncIterator]()
    await iterator.next()
    input.adjust('这是关闭前的调整', '00000000-0000-4000-8000-000000000002')
    input.close()

    expect((await iterator.next()).value).toMatchObject({
      message: { content: '这是关闭前的调整' }, priority: 'now',
    })
    expect(await iterator.next()).toEqual({ value: undefined, done: true })
  })
})
