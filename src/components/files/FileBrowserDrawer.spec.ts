// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectFileEntry, ProjectFilePreview } from '../../domain/models'
import FileBrowserDrawer from './FileBrowserDrawer.vue'
import FilePreview from './FilePreview.vue'

const src: ProjectFileEntry = { name: 'src', path: 'src', kind: 'directory', extension: null }
const readme: ProjectFileEntry = { name: 'README.md', path: 'README.md', kind: 'file', extension: 'md' }
const preview: ProjectFilePreview = {
  path: 'README.md', kind: 'text', mimeType: 'text/markdown', content: '# Hello', bytes: null, size: 7,
}
const client = {
  listDirectory: vi.fn(),
  search: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  clear: vi.fn(),
}

vi.mock('../../services/projectFiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/projectFiles')>()
  return { ...actual, createProjectFilesClient: vi.fn(() => client) }
})

function mountDrawer() {
  return mount(FileBrowserDrawer, {
    props: { projectId: 'project-1', projectName: 'claudeDesk', width: 680 },
    attachTo: document.body,
  })
}

describe('FileBrowserDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    client.listDirectory.mockResolvedValue([src, readme])
    client.search.mockResolvedValue([readme])
    client.read.mockResolvedValue(preview)
    client.write.mockResolvedValue(undefined)
  })

  it('loads the project root and exposes filter focus', async () => {
    const wrapper = mountDrawer()
    await flushPromises()

    expect(client.listDirectory).toHaveBeenCalledWith('', false)
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(2)
    await wrapper.vm.focusFilter()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="file-filter"]').element)
    wrapper.unmount()
  })

  it('loads directories, opens a file preview, refreshes, and closes only the preview', async () => {
    const main: ProjectFileEntry = { name: 'main.ts', path: 'src/main.ts', kind: 'file', extension: 'ts' }
    client.listDirectory.mockImplementation(async (path: string) => path === 'src' ? [main] : [src, readme])
    const wrapper = mountDrawer()
    await flushPromises()

    await wrapper.get('[data-path="src"]').trigger('click')
    await flushPromises()
    expect(client.listDirectory).toHaveBeenCalledWith('src', false)

    await wrapper.get('[data-path="README.md"]').trigger('click')
    await flushPromises()
    expect(client.read).toHaveBeenCalledWith('README.md', false)
    expect(wrapper.find('.file-preview').exists()).toBe(true)

    await wrapper.get('.file-preview [title="刷新"]').trigger('click')
    await flushPromises()
    expect(client.read).toHaveBeenLastCalledWith('README.md', true)

    await wrapper.get('.file-preview [title="关闭"]').trigger('click')
    expect(wrapper.find('.file-preview').exists()).toBe(false)
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('saves edited text, refreshes the preview, and forwards code actions to the conversation', async () => {
    const wrapper = mountDrawer()
    await flushPromises()
    await wrapper.get('[data-path="README.md"]').trigger('click')
    await flushPromises()

    const filePreview = wrapper.findComponent(FilePreview)
    filePreview.vm.$emit('save', '# Updated')
    await flushPromises()
    expect(client.write).toHaveBeenCalledWith('README.md', '# Updated')
    expect(client.read).toHaveBeenLastCalledWith('README.md', true)

    filePreview.vm.$emit('add-to-conversation', 'README.md', 1, 1, '# Hello')
    expect(wrapper.emitted('add-to-conversation')).toEqual([['README.md', 1, 1, '# Hello']])
    wrapper.unmount()
  })

  it('does not close the drawer when Delete is pressed in the file editor', async () => {
    const wrapper = mountDrawer()
    await flushPromises()
    await wrapper.get('[data-path="README.md"]').trigger('click')
    await flushPromises()
    const code = wrapper.get('.source-code')
    const range = document.createRange()
    range.selectNodeContents(code.element)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    await wrapper.get('.source-view').trigger('mouseup')
    await wrapper.get('[data-testid="edit-selection"]').trigger('click')

    await wrapper.get('[data-testid="file-editor"]').trigger('keydown', { key: 'Delete' })

    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not close the drawer when Delete is pressed in a comment input', async () => {
    const wrapper = mountDrawer()
    await flushPromises()
    await wrapper.get('[data-path="README.md"]').trigger('click')
    await flushPromises()
    const code = wrapper.get('.source-code')
    const range = document.createRange()
    range.selectNodeContents(code.element)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    await wrapper.get('.source-view').trigger('mouseup')
    await wrapper.get('[data-testid="comment-selection"]').trigger('click')

    await wrapper.get('[data-testid="comment-input"]').trigger('keydown', { key: 'Delete' })

    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('debounces search and discards stale results returned by the service', async () => {
    vi.useFakeTimers()
    client.search.mockResolvedValueOnce(null).mockResolvedValueOnce([readme])
    const wrapper = mountDrawer()
    await flushPromises()
    const input = wrapper.get('[data-testid="file-filter"]')

    await input.setValue('read')
    await vi.advanceTimersByTimeAsync(120)
    await input.setValue('readme')
    await vi.advanceTimersByTimeAsync(120)
    await flushPromises()

    expect(client.search).toHaveBeenNthCalledWith(1, 'read')
    expect(client.search).toHaveBeenNthCalledWith(2, 'readme')
    expect(wrapper.find('[data-path="README.md"]').exists()).toBe(true)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('clears the filter before closing on Escape and clamps resize output', async () => {
    const wrapper = mountDrawer()
    await flushPromises()
    const input = wrapper.get('[data-testid="file-filter"]')
    await input.setValue('readme')

    await wrapper.get('[data-testid="files-drawer"]').trigger('keydown', { key: 'Escape' })
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.get('[data-testid="files-drawer"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)

    wrapper.get('[data-testid="drawer-resizer"]').element.dispatchEvent(new MouseEvent('pointerdown', { clientX: 500 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1000 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(wrapper.emitted('resize')?.at(-1)).toEqual([520])
    wrapper.unmount()
  })
})
