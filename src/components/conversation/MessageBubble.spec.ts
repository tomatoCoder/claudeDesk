// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MessageBubble from './MessageBubble.vue'

describe('MessageBubble', () => {
  it('把用户提问放入独立的右侧气泡轨道', () => {
    const wrapper = mount(MessageBubble, { props: { role: 'user', text: '确认' } })

    expect(wrapper.get('article').classes()).toContain('user')
    expect(wrapper.get('.user-bubble').text()).toBe('确认')
  })

  it('助手回复直接展示正文且不显示身份标识', () => {
    const wrapper = mount(MessageBubble, { props: { role: 'assistant', text: '已经处理完成。' } })

    expect(wrapper.find('.avatar').exists()).toBe(false)
    expect(wrapper.get('.assistant-content').text()).toBe('已经处理完成。')
  })
})
