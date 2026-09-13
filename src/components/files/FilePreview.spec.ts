// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectFilePreview } from '../../domain/models'
import FilePreview from './FilePreview.vue'

const textPreview: ProjectFilePreview = {
  path: 'src/main.ts',
  kind: 'text',
  mimeType: 'text/plain',
  content: 'const answer = 42\nconsole.log(answer)',
  bytes: null,
  size: 37,
}

describe('FilePreview', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders text with line numbers and highlighted source', async () => {
    const wrapper = mount(FilePreview, { props: { preview: textPreview, loading: false, error: '' } })

    expect(wrapper.findAll('.source-line')).toHaveLength(2)
    expect(wrapper.findAll('.line-number').map((line) => line.text())).toEqual(['1', '2'])
    expect(wrapper.get('.source-code').text()).toContain('const answer = 42')
    expect(wrapper.find('.hljs-keyword').exists()).toBe(true)

    await wrapper.get('[data-testid="copy-file"]').trigger('click')
    expect(wrapper.emitted('copy')).toEqual([[textPreview.content]])
  })

  it('shows selection actions and submits an inline comment for the selected lines', async () => {
    const wrapper = mount(FilePreview, { props: { preview: textPreview, loading: false, error: '' }, attachTo: document.body })
    const firstLine = wrapper.findAll('.source-code')[0]
    const range = document.createRange()
    range.selectNodeContents(firstLine.element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    await wrapper.get('.source-view').trigger('mouseup')
    expect(wrapper.get('[data-testid="add-to-conversation"]').text()).toContain('添加到会话')

    await wrapper.get('[data-testid="comment-selection"]').trigger('click')
    expect(wrapper.get('[data-testid="comment-card"]').text()).toContain('第 R1 至 R1 行的本地评论')
    await wrapper.get('[data-testid="comment-input"]').setValue('这里需要改成常量')
    await wrapper.get('[data-testid="submit-comment"]').trigger('click')
    expect(wrapper.emitted('comment')).toEqual([['src/main.ts', 1, 1, 'const answer = 42', '这里需要改成常量']])
    wrapper.unmount()
  })

  it('turns selected text into an editable buffer and emits the saved content', async () => {
    const wrapper = mount(FilePreview, { props: { preview: textPreview, loading: false, error: '' }, attachTo: document.body })
    const firstLine = wrapper.findAll('.source-code')[0]
    const range = document.createRange()
    range.selectNodeContents(firstLine.element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    await wrapper.get('.source-view').trigger('mouseup')

    await wrapper.get('[data-testid="edit-selection"]').trigger('click')
    const editor = wrapper.get('[data-testid="file-editor"]')
    await editor.setValue('const answer = 43\nconsole.log(answer)')
    await wrapper.get('[data-testid="save-file"]').trigger('click')
    expect(wrapper.emitted('save')).toEqual([['const answer = 43\nconsole.log(answer)']])
    wrapper.unmount()
  })

  it('preserves multiline code selection without line numbers or lost indentation', async () => {
    const indented: ProjectFilePreview = {
      ...textPreview,
      content: '  const answer = 42\n    console.log(answer)',
    }
    const wrapper = mount(FilePreview, { props: { preview: indented, loading: false, error: '' }, attachTo: document.body })
    const [firstLine, secondLine] = wrapper.findAll('.source-code')
    const range = document.createRange()
    range.setStart(firstLine.element, 0)
    range.setEnd(secondLine.element, secondLine.element.childNodes.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    await wrapper.get('.source-view').trigger('mouseup')
    await wrapper.get('[data-testid="add-to-conversation"]').trigger('click')

    expect(wrapper.emitted('add-to-conversation')).toEqual([[
      'src/main.ts', 1, 2, '  const answer = 42\n    console.log(answer)',
    ]])
    wrapper.unmount()
  })

  it('switches Markdown between source and sanitized preview', async () => {
    const markdown: ProjectFilePreview = {
      ...textPreview,
      path: 'README.md',
      content: '# Title\n<script>alert(1)</script>',
    }
    const wrapper = mount(FilePreview, { props: { preview: markdown, loading: false, error: '' } })
    expect(wrapper.find('.source-view').exists()).toBe(true)

    await wrapper.get('[data-testid="toggle-markdown-preview"]').trigger('click')

    expect(wrapper.get('.markdown-preview').text()).toContain('Title')
    expect(wrapper.find('.markdown-preview script').exists()).toBe(false)
  })

  it('creates and revokes a Blob URL for image bytes', async () => {
    const image: ProjectFilePreview = {
      path: 'assets/pixel.png', kind: 'image', mimeType: 'image/png', content: null,
      bytes: [137, 80, 78, 71], size: 4,
    }
    const wrapper = mount(FilePreview, { props: { preview: image, loading: false, error: '' } })
    expect(wrapper.get('img').attributes('src')).toBe('blob:preview')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('shows supported states for binary, oversized, loading, and errors', async () => {
    const binary: ProjectFilePreview = {
      path: 'archive.bin', kind: 'binary', mimeType: null, content: null, bytes: null, size: 1024,
    }
    const wrapper = mount(FilePreview, { props: { preview: binary, loading: false, error: '' } })
    expect(wrapper.get('.preview-state').text()).toContain('二进制')

    await wrapper.setProps({ preview: { ...binary, kind: 'too_large', size: 3 * 1024 * 1024 } })
    expect(wrapper.get('.preview-state').text()).toContain('过大')
    expect(wrapper.find('[data-testid="copy-file"]').attributes('disabled')).toBeDefined()

    await wrapper.setProps({ preview: null, loading: true })
    expect(wrapper.get('.preview-state').text()).toContain('读取中')
    await wrapper.setProps({ loading: false, error: 'permission denied' })
    expect(wrapper.get('.preview-state').text()).toContain('permission denied')
  })
})
