// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppSidebar from './AppSidebar.vue'

const cli = {
  status: 'ready' as const,
  path: '/usr/local/bin/claude',
  version: '2.1.223',
  message: 'Claude CLI 已就绪',
}

describe('AppSidebar', () => {
  it('在品牌标题中显示应用 logo', () => {
    const wrapper = mount(AppSidebar, {
      props: {
        projects: [],
        tasks: [],
        selectedProjectId: null,
        selectedTaskId: null,
        cli,
      },
    })

    const logo = wrapper.get('.brand-logo')
    expect(logo.element.tagName).toBe('IMG')
    expect(logo.attributes('src')).toMatch(/app-logo\.png$/)
  })
})
