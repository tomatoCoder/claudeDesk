import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectFileEntry, ProjectFilePreview } from '../domain/models'

const mocks = vi.hoisted(() => ({
  listProjectDirectory: vi.fn(),
  searchProjectFiles: vi.fn(),
  readProjectFile: vi.fn(),
}))

vi.mock('./ipc', () => ({ ipc: mocks }))

import { createProjectFilesClient, sortProjectEntries } from './projectFiles'

const directory: ProjectFileEntry = { name: 'src', path: 'src', kind: 'directory', extension: null }
const file: ProjectFileEntry = { name: 'main.ts', path: 'src/main.ts', kind: 'file', extension: 'ts' }
const preview: ProjectFilePreview = {
  path: 'src/main.ts', kind: 'text', mimeType: 'text/plain', content: 'main', bytes: null, size: 4,
}

beforeEach(() => vi.clearAllMocks())

describe('projectFiles client', () => {
  it('deduplicates concurrent directory and preview reads', async () => {
    mocks.listProjectDirectory.mockResolvedValue([directory, file])
    mocks.readProjectFile.mockResolvedValue(preview)
    const client = createProjectFilesClient('project-1')

    const firstList = client.listDirectory('src')
    const secondList = client.listDirectory('src')
    const firstRead = client.read('src/main.ts')
    const secondRead = client.read('src/main.ts')

    expect(firstList).toBe(secondList)
    expect(firstRead).toBe(secondRead)
    await Promise.all([firstList, firstRead])
    expect(mocks.listProjectDirectory).toHaveBeenCalledTimes(1)
    expect(mocks.readProjectFile).toHaveBeenCalledTimes(1)
  })

  it('evicts rejected requests so retry reaches IPC again', async () => {
    mocks.listProjectDirectory
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([file])
    const client = createProjectFilesClient('project-1')

    await expect(client.listDirectory('')).rejects.toThrow('offline')
    await expect(client.listDirectory('')).resolves.toEqual([file])

    expect(mocks.listProjectDirectory).toHaveBeenCalledTimes(2)
  })

  it('sorts directories first and names case-insensitively', () => {
    const entries: ProjectFileEntry[] = [
      { name: 'z.ts', path: 'z.ts', kind: 'file', extension: 'ts' },
      { name: 'zDir', path: 'zDir', kind: 'directory', extension: null },
      { name: 'A.ts', path: 'A.ts', kind: 'file', extension: 'ts' },
      { name: 'aDir', path: 'aDir', kind: 'directory', extension: null },
    ]

    expect(sortProjectEntries(entries).map((entry) => entry.name)).toEqual(['aDir', 'zDir', 'A.ts', 'z.ts'])
  })

  it('returns null for a search response superseded by a newer query', async () => {
    let resolveOld!: (entries: ProjectFileEntry[]) => void
    let resolveNew!: (entries: ProjectFileEntry[]) => void
    mocks.searchProjectFiles
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveNew = resolve }))
    const client = createProjectFilesClient('project-1')

    const oldSearch = client.search('old')
    const newSearch = client.search('new')
    resolveNew([file])
    await expect(newSearch).resolves.toEqual([file])
    resolveOld([directory])
    await expect(oldSearch).resolves.toBeNull()
  })

  it('does not call IPC for an empty search', async () => {
    const client = createProjectFilesClient('project-1')
    await expect(client.search('   ')).resolves.toEqual([])
    expect(mocks.searchProjectFiles).not.toHaveBeenCalled()
  })
})
