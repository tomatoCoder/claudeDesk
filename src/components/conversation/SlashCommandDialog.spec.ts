// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/ipc', () => ({
  ipc: {
    setTaskModel: vi.fn().mockResolvedValue({ id: 'task-1', modelOverride: 'sonnet' }),
    setTaskPermissionMode: vi.fn().mockResolvedValue({ id: 'task-1', permissionModeOverride: 'plan' }),
  },
  errorMessage: (error: unknown) => String((error as { message?: string })?.message ?? error),
  isDesktop: () => false,
}))
import SlashCommandDialog from './SlashCommandDialog.vue'
import { ipc } from '../../services/ipc'

const task = {
  id: 'task-1', projectId: 'project-1', title: '新任务', claudeSessionId: null,
  status: 'idle' as const, modelOverride: null, permissionModeOverride: null,
  createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
}
const models = [
  { value: 'sonnet', displayName: 'Sonnet', description: 'Balanced', resolvedModel: null },
  { value: 'opus', displayName: 'Opus', description: 'Powerful', resolvedModel: null },
]

describe('SlashCommandDialog', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('模型对话框列出目录模型与跟随应用设置，选择后调用 set_task_model 并抛出最新任务', async () => {
    const wrapper = mount(SlashCommandDialog, { props: { kind: 'model', task, models } })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    const options = wrapper.findAll('[data-option]')
    expect(options).toHaveLength(3)
    await options[1].trigger('click')
    expect(ipc.setTaskModel).toHaveBeenCalledWith('task-1', 'sonnet')
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'task-1', modelOverride: 'sonnet' }])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('打开后焦点落在第一个选项上', () => {
    const wrapper = mount(SlashCommandDialog, { props: { kind: 'model', task, models }, attachTo: document.body })
    expect(document.activeElement).toBe(wrapper.findAll('[data-option]')[0].element)
    wrapper.unmount()
  })

  it('跟随应用设置清除覆盖', async () => {
    const wrapper = mount(SlashCommandDialog, { props: { kind: 'model', task, models } })
    await wrapper.findAll('[data-option]')[0].trigger('click')
    expect(ipc.setTaskModel).toHaveBeenCalledWith('task-1', '')
  })

  it('权限对话框只提供四个安全模式', async () => {
    const wrapper = mount(SlashCommandDialog, { props: { kind: 'permissions', task, models } })
    const options = wrapper.findAll('[data-option]')
    expect(options).toHaveLength(5)
    await options[1].trigger('click')
    expect(ipc.setTaskPermissionMode).toHaveBeenCalledWith('task-1', 'default')
  })

  it('失败时保留对话框并显示错误', async () => {
    vi.mocked(ipc.setTaskModel).mockRejectedValueOnce({ message: 'boom' })
    const wrapper = mount(SlashCommandDialog, { props: { kind: 'model', task, models } })
    await wrapper.findAll('[data-option]')[1].trigger('click')
    expect(wrapper.text()).toContain('boom')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('Escape 触发关闭且不调用 IPC', async () => {
    const wrapper = mount(SlashCommandDialog, { props: { kind: 'model', task, models } })
    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(ipc.setTaskModel).not.toHaveBeenCalled()
  })
})
