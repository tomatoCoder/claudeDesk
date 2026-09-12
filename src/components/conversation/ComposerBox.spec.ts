// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ComposerBox from './ComposerBox.vue'

const commands = [
  { name: 'review', description: 'Review code', argumentHint: '<path>', aliases: [] },
  { name: 'permissions', description: 'Manage permissions', argumentHint: '', aliases: [] },
]

function mountComposer() {
  return mount(ComposerBox, {
    props: {
      status: 'idle' as const,
      queuedTurns: [],
      commands,
      submit: vi.fn().mockResolvedValue(undefined),
      adjust: vi.fn().mockResolvedValue(undefined),
      sendNow: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    },
  })
}

async function typeSlash(wrapper: ReturnType<typeof mountComposer>) {
  const textarea = wrapper.find('textarea')
  await textarea.setValue('/')
  await textarea.trigger('input')
  await textarea.trigger('click')
  return textarea
}

describe('ComposerBox slash menu', () => {
  it('输入 / 打开菜单，Enter 填入命令但不发送', async () => {
    const wrapper = mountComposer()
    const textarea = await typeSlash(wrapper)
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)

    await textarea.trigger('keydown', { key: 'Enter' })
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('/review ')
    expect(wrapper.props('submit')).not.toHaveBeenCalled()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('ArrowDown 移动选中项，Tab 填入', async () => {
    const wrapper = mountComposer()
    const textarea = await typeSlash(wrapper)
    await textarea.trigger('keydown', { key: 'ArrowDown' })
    await textarea.trigger('keydown', { key: 'Tab' })
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('/permissions ')
  })

  it('Escape 关闭菜单，之后 Enter 恢复发送行为', async () => {
    const wrapper = mountComposer()
    const textarea = await typeSlash(wrapper)
    await textarea.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(wrapper.props('submit')).toHaveBeenCalledWith('/')
  })

  it('Cmd+Enter 在菜单打开时仍是换行而不是发送', async () => {
    const wrapper = mountComposer()
    const textarea = await typeSlash(wrapper)
    await textarea.trigger('keydown', { key: 'Enter', metaKey: true })
    expect(wrapper.props('submit')).not.toHaveBeenCalled()
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('/\n')
  })

  it('无匹配项时 Enter 直接按原文发送', async () => {
    const wrapper = mountComposer()
    const textarea = await typeSlash(wrapper)
    await textarea.setValue('/zzz')
    await textarea.trigger('input')
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(wrapper.props('submit')).toHaveBeenCalledWith('/zzz')
  })

  it('普通文本输入不打开菜单', async () => {
    const wrapper = mountComposer()
    await wrapper.find('textarea').setValue('hello /world')
    await wrapper.find('textarea').trigger('input')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('无匹配的空态下 Escape 也能关闭菜单', async () => {
    const wrapper = mountComposer()
    const textarea = await typeSlash(wrapper)
    await textarea.setValue('/zzz')
    await textarea.trigger('input')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    await textarea.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('submit 返回 false（裸命令被拦截）时保留输入并关闭菜单', async () => {
    const submit = vi.fn().mockResolvedValue(false)
    const wrapper = mount(ComposerBox, {
      props: {
        status: 'idle' as const, queuedTurns: [], commands,
        submit, adjust: vi.fn().mockResolvedValue(undefined), sendNow: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined),
      },
    })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('/model')
    await textarea.trigger('input')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    await textarea.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(submit).toHaveBeenCalledWith('/model')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('/model')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('菜单渲染在 overflow:hidden 的 composer 之外，避免被裁剪不可见', async () => {
    const wrapper = mountComposer()
    await typeSlash(wrapper)
    const menu = wrapper.find('[role="listbox"]')
    expect(menu.exists()).toBe(true)
    expect(wrapper.find('.composer').element.contains(menu.element)).toBe(false)
    expect(wrapper.find('.composer-wrap').element.contains(menu.element)).toBe(true)
  })

  it('目录在菜单打开期间变短时选中下标自动收敛', async () => {
    const wrapper = mountComposer()
    const textarea = await typeSlash(wrapper)
    await textarea.trigger('keydown', { key: 'ArrowDown' })
    await wrapper.setProps({ commands: [commands[0]] })
    await textarea.trigger('keydown', { key: 'Enter' })
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('/review ')
  })
})
