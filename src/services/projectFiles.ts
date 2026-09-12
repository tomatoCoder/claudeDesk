import type { ProjectFileEntry, ProjectFilePreview } from '../domain/models'
import { ipc } from './ipc'

export interface ProjectFilesClient {
  listDirectory: (path: string, force?: boolean) => Promise<ProjectFileEntry[]>
  search: (query: string) => Promise<ProjectFileEntry[] | null>
  read: (path: string, force?: boolean) => Promise<ProjectFilePreview>
  clear: () => void
}

export function sortProjectEntries(entries: ProjectFileEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
    const insensitive = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    return insensitive || left.name.localeCompare(right.name)
  })
}

export function createProjectFilesClient(projectId: string): ProjectFilesClient {
  const directories = new Map<string, Promise<ProjectFileEntry[]>>()
  const previews = new Map<string, Promise<ProjectFilePreview>>()
  let searchVersion = 0

  function listDirectory(path: string, force = false) {
    if (force) directories.delete(path)
    const cached = directories.get(path)
    if (cached) return cached
    const pending = ipc.listProjectDirectory(projectId, path)
      .then(sortProjectEntries)
      .catch((cause) => {
        if (directories.get(path) === pending) directories.delete(path)
        throw cause
      })
    directories.set(path, pending)
    return pending
  }

  function read(path: string, force = false) {
    if (force) previews.delete(path)
    const cached = previews.get(path)
    if (cached) return cached
    const pending = ipc.readProjectFile(projectId, path).catch((cause) => {
      if (previews.get(path) === pending) previews.delete(path)
      throw cause
    })
    previews.set(path, pending)
    return pending
  }

  async function search(query: string) {
    const version = ++searchVersion
    const normalized = query.trim()
    if (!normalized) return []
    const entries = await ipc.searchProjectFiles(projectId, normalized, 200)
    return version === searchVersion ? entries : null
  }

  function clear() {
    directories.clear()
    previews.clear()
    searchVersion += 1
  }

  return { listDirectory, search, read, clear }
}
