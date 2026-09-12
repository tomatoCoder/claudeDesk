// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SlashCommandMenu from './SlashCommandMenu.vue'

const items = [
  { command: { name: 'review', description: 'Review code', argumentHint: '<path>', aliases: ['rv'] }, matchedAlias: null },
  { command: { name: 'inspect', description: '', argumentHint: '', aliases: [] }, matchedAlias: null },
]

describe('SlashCommandMenu', () => {
  it('渲染 listbox 语义与命令信息', () => {
    const wrapper = mount(SlashCommandMenu, { props: { items, activeIndex: 1, loading: false, error: '' } })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    const options = wrapper.findAll('[role="option"]')
    expect(options).toHaveLength(2)
    expect(options[0].text()).toContain('/review')
    expect(options[0].text()).toContain('Review code')
    expect(options[0].text()).toContain('<path>')
    expect(options[1].attributes('aria-selected')).toBe('true')
  })

  it('点击选项时 emit 对应下标', async () => {
    const wrapper = mount(SlashCommandMenu, { props: { items, activeIndex: 0, loading: false, error: '' } })
    await wrapper.findAll('[role="option"]')[1].trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([1])
  })

  it('展示加载与错误状态', () => {
    const loading = mount(SlashCommandMenu, { props: { items: [], activeIndex: 0, loading: true, error: '' } })
    expect(loading.text()).toContain('正在从 CLI 加载命令')
    const error = mount(SlashCommandMenu, { props: { items: [], activeIndex: 0, loading: false, error: 'boom' } })
    expect(error.text()).toContain('boom')
    expect(error.find('button').exists()).toBe(true)
  })
})
