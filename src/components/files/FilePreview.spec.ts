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
