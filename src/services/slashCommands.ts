import { ipc } from './ipc'
import type { SlashCommandCatalogDto, SlashCommandDto } from '../domain/models'

const cache = new Map<string, Promise<SlashCommandCatalogDto>>()

export function loadSlashCommandCatalog(projectId: string, force = false): Promise<SlashCommandCatalogDto> {
  if (force) cache.delete(projectId)
  const existing = cache.get(projectId)
  if (existing) return existing
  const pending = ipc.listSlashCommands(projectId, force).catch((cause: unknown) => {
    cache.delete(projectId)
    throw cause
  })
  cache.set(projectId, pending)
  return pending
}

export function invalidateSlashCommandCatalog(projectId: string) {
  cache.delete(projectId)
}

export interface RankedSlashCommand {
  command: SlashCommandDto
  matchedAlias: string | null
}

export function filterSlashCommands(commands: SlashCommandDto[], query: string): RankedSlashCommand[] {
  const prefix = query.trim().replace(/^\//, '').toLowerCase()
  if (!prefix) return commands.map((command) => ({ command, matchedAlias: null }))
  const byName: RankedSlashCommand[] = []
  const byAlias: RankedSlashCommand[] = []
  for (const command of commands) {
    if (command.name.toLowerCase().startsWith(prefix)) byName.push({ command, matchedAlias: null })
    else {
      const alias = command.aliases.find((item) => item.toLowerCase().startsWith(prefix))
      if (alias) byAlias.push({ command, matchedAlias: alias })
    }
  }
  return [...byName, ...byAlias]
}
