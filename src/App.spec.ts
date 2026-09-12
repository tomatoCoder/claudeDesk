// @vitest-environment jsdom
import { defineComponent, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'

const drawerFocus = vi.fn()
const projects = {
  projects: [{ id: 'p1', name: 'claudeDesk', path: '/repo', createdAt: '', lastOpenedAt: '' }],
  tasks: [{ id: 't1', projectId: 'p1', title: 'Task', claudeSessionId: null, modelOverride: null, permissionModeOverride: null, status: 'idle', createdAt: '', updatedAt: '' }],
  settings: { claudePath: null, sidebarWidth: 280, theme: 'light', language: 'zh-CN', openWith: 'default', permissionMode: 'default' },
  cli: { status: 'ready', path: '/bin/claude', version: '1', message: '' },
  selectedProjectId: 'p1', selectedTaskId: 't1',
  selectedProject: { id: 'p1', name: 'claudeDesk', path: '/repo', createdAt: '', lastOpenedAt: '' },
  selectedTask: { id: 't1', projectId: 'p1', title: 'Task', claudeSessionId: null, modelOverride: null, permissionModeOverride: null, status: 'idle', createdAt: '', updatedAt: '' },
  hydrate: vi.fn(), selectProject: vi.fn(), selectTask: vi.fn(), addProject: vi.fn(), createTask: vi.fn(),
  renameTask: vi.fn(), removeProject: vi.fn(), updateTaskStatus: vi.fn(), patchTask: vi.fn(),
  refreshDiagnostic: vi.fn(), persistSettings: vi.fn(),
}

vi.mock('./stores/projects', () => ({ useProjectsStore: () => projects }))
vi.mock('./stores/runtime', () => ({ useRuntimeStore: () => ({ events: () => [], queuedTurns: () => [], load: vi.fn(), loadQueuedTurns: vi.fn(), accept: vi.fn(), replaceQueuedTurns: vi.fn() }) }))
vi.mock('./services/taskEvents', () => ({ listenToTaskEvents: vi.fn(async () => vi.fn()) }))
vi.mock('./services/queuedTurns', () => ({ listenToQueuedTurns: vi.fn(async () => vi.fn()) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))
vi.mock('./services/ipc', () => ({
  chooseProjectDirectory: vi.fn(), errorMessage: (cause: unknown) => String(cause),
  ipc: { loadClaudeSettings: vi.fn(async () => ({ values: { model: '' }, raw: '{}', version: '1', path: '' })) },
}))

const DrawerStub = defineComponent({
  name: 'FileBrowserDrawer',
  props: ['projectId', 'projectName', 'width'],
  emits: ['close', 'resize'],
  setup(_, { expose }) { expose({ focusFilter: drawerFocus }); return {} },
  template: '<aside data-testid="drawer-stub" />',
})

function mountApp() {
  return mount(App, {
    global: {
      stubs: {
        AppSidebar: true,
        ConversationView: { template: '<section data-testid="conversation-stub" />' },
        FileBrowserDrawer: DrawerStub,
        StatusPill: true,
        InlineError: true,
      },
    },
  })
}

describe('Files integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
  })

  it('opens a right drawer without replacing the conversation', async () => {
    const wrapper = mountApp()
    await flushPromises()
    const conversation = wrapper.get('[data-testid="conversation-stub"]').element

    await wrapper.get('[data-testid="files-button"]').trigger('click')

    expect(wrapper.findComponent(DrawerStub).props('projectId')).toBe('p1')
    expect(wrapper.get('[data-testid="conversation-stub"]').element).toBe(conversation)
    wrapper.unmount()
  })

  it('opens and focuses Files with Command+P while blocking settings', async () => {
    const wrapper = mountApp()
    await flushPromises()
    const shortcut = new KeyboardEvent('keydown', { key: 'p', metaKey: true, cancelable: true })
    window.dispatchEvent(shortcut)
    await nextTick()
    expect(shortcut.defaultPrevented).toBe(true)
    expect(wrapper.find('[data-testid="drawer-stub"]').exists()).toBe(true)
    expect(drawerFocus).toHaveBeenCalled()

    await wrapper.get('[data-testid="files-button"]').trigger('click')
    wrapper.findComponent({ name: 'AppSidebar' }).vm.$emit('settings')
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true }))
    expect(wrapper.find('[data-testid="drawer-stub"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
