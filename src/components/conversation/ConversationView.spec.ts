// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { TaskEvent } from '../../domain/events'
import ConversationView from './ConversationView.vue'

vi.mock('../../services/ipc', () => ({
  ipc: {
    listSlashCommands: vi.fn().mockRejectedValue(new Error('jsdom 无 Tauri IPC')),
    setTaskModel: vi.fn().mockResolvedValue({ id: 'task-1', modelOverride: 'sonnet' }),
    setTaskPermissionMode: vi.fn().mockResolvedValue({ id: 'task-1', permissionModeOverride: 'plan' }),
    resolvePermission: vi.fn(),
    readDragFilePaths: vi.fn().mockResolvedValue([]),
  },
  errorMessage: (error: unknown) => String((error as { message?: string })?.message ?? error),
  isDesktop: () => false,
}))

const task = {
  id: 'task-1',
  projectId: 'project-1',
  title: '新任务',
  claudeSessionId: 'session-1',
  modelOverride: null,
  permissionModeOverride: null,
  status: 'completed' as const,
  createdAt: '2026-09-10T00:00:00Z',
  updatedAt: '2026-09-10T00:00:00Z',
}

function event<K extends TaskEvent['kind']>(sequence: number, kind: K, data: Extract<TaskEvent, { kind: K }>['data']): TaskEvent {
  return {
    version: 1,
    taskId: task.id,
    runId: 'run-1',
    sequence,
    createdAt: '2026-09-10T00:00:00Z',
    kind,
    data,
  } as TaskEvent
}

describe('ConversationView', () => {
  it('把同一轮的流式片段与最终消息合并为一条助手回复', () => {
    const events = [
      event(1, 'user_message', { text: 'Hello' }),
      event(2, 'assistant_delta', { messageId: 'delta-1', text: 'Hel' }),
      event(3, 'assistant_delta', { messageId: 'delta-2', text: 'lo' }),
      event(4, 'assistant_message', { messageId: 'final-1', markdown: 'Hello' }),
    ]
    const wrapper = mount(ConversationView, { props: { task, events, cliReady: true } })

    const replies = wrapper.findAll('.message.assistant')
    expect(replies).toHaveLength(1)
    expect(replies[0].text()).toBe('Hello')
  })

  it('把 local_command_output 渲染为带 CLI 标记的时间线条目', () => {
    const events = [
      event(1, 'user_message', { text: '/help' }),
      event(2, 'local_command_output', { content: 'Available commands' }),
    ]
    const wrapper = mount(ConversationView, { props: { task, events, cliReady: true } })
    const cli = wrapper.find('.cli-output')
    expect(cli.exists()).toBe(true)
    expect(cli.text()).toContain('CLI')
    expect(cli.text()).toContain('Available commands')
  })

  it('裸 /model 打开对话框而不发送', async () => {
    const submit = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(ConversationView, { props: { task, events: [], cliReady: true, submit } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('/model')
    await wrapper.find('[data-testid="composer-submit"]').trigger('click')
    expect(submit).not.toHaveBeenCalled()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  })

  it('裸 /config 触发 open-settings 而不发送', async () => {
    const submit = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(ConversationView, { props: { task, events: [], cliReady: true, submit } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('/config')
    await wrapper.find('[data-testid="composer-submit"]').trigger('click')
    expect(submit).not.toHaveBeenCalled()
    expect(wrapper.emitted('open-settings')).toHaveLength(1)
  })

  it('带参数命令与 Skill 原样透传', async () => {
    const submit = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(ConversationView, { props: { task, events: [], cliReady: true, submit } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('/model sonnet')
    await wrapper.find('[data-testid="composer-submit"]').trigger('click')
    expect(submit).toHaveBeenCalledWith('/model sonnet')
  })

  it('对话框保存成功后向上抛出 task-updated 并关闭', async () => {
    const wrapper = mount(ConversationView, { props: { task, events: [], cliReady: true } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('/model')
    await wrapper.find('[data-testid="composer-submit"]').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    await wrapper.findAll('[data-option]')[0].trigger('click')
    await flushPromises()
    expect(wrapper.emitted('task-updated')?.[0]).toEqual([{ id: 'task-1', modelOverride: 'sonnet' }])
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
})
