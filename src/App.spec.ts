// @vitest-environment jsdom
import { defineComponent, nextTick, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { listen } from '@tauri-apps/api/event'
import { ipc } from './services/ipc'

const drawerFocus = vi.fn()
const conversationInsert = vi.fn()
const projects = reactive({
  projects: [{ id: 'p1', name: 'claudeDesk', path: '/repo', createdAt: '', lastOpenedAt: '' }],
  tasks: [{ id: 't1', projectId: 'p1', title: 'Task', claudeSessionId: null, modelOverride: null, permissionModeOverride: null, status: 'idle', createdAt: '', updatedAt: '' }],
  settings: { claudePath: null, sidebarWidth: 280, theme: 'light', language: 'zh-CN', openWith: 'default', terminalApp: 'default', permissionMode: 'default' },
  cli: { status: 'ready', path: '/bin/claude', version: '1', message: '' },
  selectedProjectId: 'p1', selectedTaskId: 't1',
  selectedProject: { id: 'p1', name: 'claudeDesk', path: '/repo', createdAt: '', lastOpenedAt: '' },
  selectedTask: { id: 't1', projectId: 'p1', title: 'Task', claudeSessionId: null, modelOverride: null, permissionModeOverride: null, status: 'idle', createdAt: '', updatedAt: '' },
  hydrate: vi.fn(), selectProject: vi.fn(), selectTask: vi.fn(), addProject: vi.fn(), createTask: vi.fn(),
  renameTask: vi.fn(), removeProject: vi.fn(), updateTaskStatus: vi.fn(), patchTask: vi.fn(),
  refreshDiagnostic: vi.fn(), persistSettings: vi.fn(),
})

vi.mock('./stores/projects', () => ({ useProjectsStore: () => projects }))
vi.mock('./stores/runtime', () => ({ useRuntimeStore: () => ({ events: () => [], queuedTurns: () => [], load: vi.fn(), loadQueuedTurns: vi.fn(), accept: vi.fn(), replaceQueuedTurns: vi.fn() }) }))
vi.mock('./services/taskEvents', () => ({ listenToTaskEvents: vi.fn(async () => vi.fn()) }))
vi.mock('./services/queuedTurns', () => ({ listenToQueuedTurns: vi.fn(async () => vi.fn()) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))
vi.mock('./services/ipc', () => ({
  chooseProjectDirectory: vi.fn(), errorMessage: (cause: unknown) => String(cause),
  ipc: { closeBrowserPanel: vi.fn(async () => {}), setBrowserPanelBounds: vi.fn(async () => {}), openBrowserPanel: vi.fn(async () => {}), openTerminal: vi.fn(async () => {}), loadClaudeSettings: vi.fn(async () => ({ values: { model: '' }, raw: '{}', version: '1', path: '' })) },
}))

const DrawerStub = defineComponent({
  name: 'FileBrowserDrawer',
  props: ['projectId', 'projectName', 'width'],
  emits: ['close', 'resize', 'add-to-conversation', 'comment'],
  setup(_, { expose }) { expose({ focusFilter: drawerFocus }); return {} },
  template: '<aside data-testid="drawer-stub" />',
})

const BrowserStub = defineComponent({
  name: 'BrowserPanel', props: ['width', 'url', 'loaded', 'loading', 'error'],
  emits: ['close', 'navigate'],
  setup(_, { expose }) {
    expose({ focusAddress: vi.fn(), webviewBounds: () => ({ x: 600, y: 100, width: 500, height: 600, viewportWidth: 1280, viewportHeight: 820 }) })
  },
  template: '<aside data-testid="browser-stub" />',
})

const ConversationStub = defineComponent({
  name: 'ConversationView',
  setup(_, { expose }) { expose({ insertDraft: conversationInsert }); return {} },
  template: '<section data-testid="conversation-stub" />',
})

const ErrorStub = defineComponent({
  name: 'InlineError',
  props: ['message'],
  template: '<div>{{ message }}</div>',
})

function mountApp() {
  return mount(App, {
    global: {
      stubs: {
        AppSidebar: true,
        ConversationView: ConversationStub,
        FileBrowserDrawer: DrawerStub,
        BrowserPanel: BrowserStub,
        StatusPill: true,
        InlineError: ErrorStub,
      },
    },
  })
}

beforeEach(() => {
    vi.clearAllMocks()
    projects.selectedTaskId = 't1'
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
  })

describe('Files integration', () => {
  it('inserts file selections and comments into the active conversation draft', async () => {
    const wrapper = mountApp()
    await flushPromises()
    await wrapper.get('[data-testid="files-button"]').trigger('click')

    wrapper.findComponent(DrawerStub).vm.$emit('add-to-conversation', 'src/main.ts', 3, 4, 'const answer = 42')
    await flushPromises()
    expect(conversationInsert).toHaveBeenCalledWith(expect.stringContaining('src/main.ts'))
    expect(conversationInsert).toHaveBeenCalledWith(expect.stringContaining('const answer = 42'))

    wrapper.findComponent(DrawerStub).vm.$emit('comment', 'src/main.ts', 3, 4, 'const answer = 42', '请改成常量')
    await flushPromises()
    expect(conversationInsert).toHaveBeenLastCalledWith(expect.stringContaining('请改成常量'))
    wrapper.unmount()
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

describe('Terminal integration', () => {
  it('opens a terminal in the selected project directory', async () => {
    const wrapper = mountApp()
    await flushPromises()
    await wrapper.get('[data-testid="terminal-button"]').trigger('click')
    expect(ipc.openTerminal).toHaveBeenCalledWith('p1')
    wrapper.unmount()
  })

  it('surfaces terminal failures in the global error banner', async () => {
    vi.mocked(ipc.openTerminal).mockRejectedValueOnce(new Error('boom'))
    const wrapper = mountApp()
    await flushPromises()
    await wrapper.get('[data-testid="terminal-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'InlineError' }).props('message')).toContain('boom')
    wrapper.unmount()
  })

  it('opens the terminal with Command+Shift+T', async () => {
    const wrapper = mountApp()
    await flushPromises()
    const shortcut = new KeyboardEvent('keydown', { key: 't', metaKey: true, shiftKey: true, cancelable: true })
    window.dispatchEvent(shortcut)
    await flushPromises()
    expect(shortcut.defaultPrevented).toBe(true)
    expect(ipc.openTerminal).toHaveBeenCalledWith('p1')
    wrapper.unmount()
  })
})


describe('Persistent browser', () => {
  it('keeps the browser mounted when switching tasks and settings', async () => {
    const wrapper = mountApp()
    await flushPromises()
    await wrapper.get('[data-testid="browser-button"]').trigger('click')
    const panel = wrapper.get('[data-testid="browser-stub"]').element
    projects.selectedTaskId = 't2'
    await flushPromises()
    expect(wrapper.find('[data-testid="browser-stub"]').element).toBe(panel)
    wrapper.findComponent({ name: 'AppSidebar' }).vm.$emit('settings')
    await flushPromises()
    expect(wrapper.find('[data-testid="browser-stub"]').element).toBe(panel)
    wrapper.unmount()
  })

  it('closes Files before opening the browser so panes cannot overflow the viewport', async () => {
    const wrapper = mountApp()
    await flushPromises()
    await wrapper.get('[data-testid="files-button"]').trigger('click')
    await wrapper.get('[data-testid="browser-button"]').trigger('click')
    expect(wrapper.findComponent(DrawerStub).exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps navigation in loading state until the native page finishes', async () => {
    const wrapper = mountApp()
    await flushPromises()
    await wrapper.get('[data-testid="browser-button"]').trigger('click')
    wrapper.findComponent(BrowserStub).vm.$emit('navigate', 'https://example.com')
    await flushPromises()
    expect(ipc.openBrowserPanel).toHaveBeenCalled()
    expect(wrapper.findComponent(BrowserStub).props('loading')).toBe(true)
    const onPage = vi.mocked(listen).mock.calls.find(([name]) => name === 'browser-page-state')![1]
    onPage({ event: 'browser-page-state', id: 1, payload: { url: 'https://example.com/redirected', loading: false } })
    await flushPromises()
    expect(wrapper.findComponent(BrowserStub).props('loading')).toBe(false)
    expect(wrapper.findComponent(BrowserStub).props('url')).toBe('https://example.com/redirected')
    wrapper.findComponent(BrowserStub).vm.$emit('close')
    await flushPromises()
    expect(ipc.closeBrowserPanel).toHaveBeenCalled()
    await wrapper.get('[data-testid="browser-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(BrowserStub).props('loaded')).toBe(true)
    expect(ipc.openBrowserPanel).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
