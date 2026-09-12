// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ProjectFileEntry } from '../../domain/models'
import ProjectFileTree from './ProjectFileTree.vue'

const src: ProjectFileEntry = { name: 'src', path: 'src', kind: 'directory', extension: null }
const docs: ProjectFileEntry = { name: 'docs', path: 'docs', kind: 'directory', extension: null }
const main: ProjectFileEntry = { name: 'main.ts', path: 'src/main.ts', kind: 'file', extension: 'ts' }
const readme: ProjectFileEntry = { name: 'README.md', path: 'README.md', kind: 'file', extension: 'md' }

function mountTree(overrides: Record<string, unknown> = {}) {
  return mount(ProjectFileTree, {
    props: {
      rootName: 'claudeDesk',
      entries: [readme, src, docs],
      childrenByPath: {},
      loadingPaths: [],
      errorPaths: {},
      query: '',
      selectedPath: null,
      ...overrides,
    },
  })
}

describe('ProjectFileTree', () => {
  it('renders directories before files and requests children on expansion', async () => {
    const wrapper = mountTree()
    expect(wrapper.findAll('[role="treeitem"]').map((row) => row.attributes('data-path')))
      .toEqual(['docs', 'src', 'README.md'])

    await wrapper.get('[data-path="src"]').trigger('click')

    expect(wrapper.emitted('expand')).toEqual([['src']])
  })

  it('shows loaded children with indentation and selects files', async () => {
    const wrapper = mountTree({ childrenByPath: { src: [main] } })
    await wrapper.get('[data-path="src"]').trigger('click')
    const child = wrapper.get('[data-path="src/main.ts"]')

    expect(child.attributes('aria-level')).toBe('2')
    await child.trigger('click')

    expect(wrapper.emitted('select')).toEqual([['src/main.ts']])
  })

  it('marks the selected row and exposes a retry for a failed directory', async () => {
    const wrapper = mountTree({ selectedPath: 'README.md', errorPaths: { src: 'denied' } })
    expect(wrapper.get('[data-path="README.md"]').classes()).toContain('selected')

    await wrapper.get('[data-path="src"]').trigger('click')
    await wrapper.get('[data-retry="src"]').trigger('click')

    expect(wrapper.text()).toContain('denied')
    expect(wrapper.emitted('retry')).toEqual([['src']])
  })

  it('supports arrow navigation and Enter selection', async () => {
    const wrapper = mountTree({ entries: [main, readme] })
    const tree = wrapper.get('[role="tree"]')
    await tree.trigger('keydown', { key: 'ArrowDown' })
    await tree.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('select')).toEqual([['README.md']])
  })

  it('renders search results as a flat list with their paths', () => {
    const wrapper = mountTree({ entries: [main], query: 'main' })
    expect(wrapper.get('[data-path="src/main.ts"]').text()).toContain('src/main.ts')
    expect(wrapper.find('[aria-level="2"]').exists()).toBe(false)
  })
})
