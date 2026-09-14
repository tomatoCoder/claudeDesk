// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TaskRow from './TaskRow.vue'

const task = { id: 't1', projectId: 'p1', title: '测试会话', claudeSessionId: 's1', modelOverride: null, permissionModeOverride: null, status: 'idle' as const, createdAt: '2026-09-09', updatedAt: '2026-09-09' }

describe('TaskRow', () => {
  it('右键显示会话重命名与删除操作', async () => {
    const wrapper = mount(TaskRow, { props: { task, selected: false } })
    await wrapper.get('.task-row').trigger('contextmenu')

    expect(wrapper.get('[role="menu"]').text()).toContain('重命名')
    expect(wrapper.get('[role="menu"]').text()).toContain('删除')
  })

  it('菜单重命名后提交会 emit 新标题', async () => {
    const wrapper = mount(TaskRow, { props: { task, selected: false } })
    await wrapper.get('.task-row').trigger('contextmenu')
    await wrapper.get('[data-action="rename"]').trigger('click')

    await wrapper.get('.rename-input').setValue('新标题')
    await wrapper.get('.rename-input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('rename')).toHaveLength(1)
    expect(wrapper.emitted('rename')![0]).toEqual(['新标题'])
  })
})
