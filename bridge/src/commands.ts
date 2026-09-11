import { query, type ModelInfo, type Query, type SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import { buildQueryOptions, type QueryContext } from './agent-adapter.js'

export interface NormalizedSlashCommand {
  name: string
  description: string
  argumentHint: string
  aliases: string[]
}

export interface NormalizedModelInfo {
  value: string
  displayName: string
  description: string
  resolvedModel: string | null
}

export interface CommandCatalog {
  commands: NormalizedSlashCommand[]
  models: NormalizedModelInfo[]
}

type QueryFactory = (params: Parameters<typeof query>[0]) => Query

export function normalizeCommandCatalog(commands: SlashCommand[], models: ModelInfo[]): CommandCatalog {
  return {
    commands: commands.flatMap((command) => {
      const name = command.name.trim()
      if (!name) return []
      return [{
        name,
        description: command.description ?? '',
        argumentHint: command.argumentHint ?? '',
        aliases: command.aliases?.filter((alias) => typeof alias === 'string') ?? [],
      }]
    }),
    models: models.flatMap((model) => {
      const value = model.value.trim()
      if (!value) return []
      return [{
        value,
        displayName: model.displayName ?? value,
        description: model.description ?? '',
        resolvedModel: model.resolvedModel ?? null,
      }]
    }),
  }
}

export async function discoverCommandCatalog(
  context: QueryContext,
  createQuery: QueryFactory = query,
): Promise<CommandCatalog> {
  const stream = createQuery({ prompt: '', options: buildQueryOptions(context) })
  try {
    const commands = await stream.supportedCommands()
    const models = await stream.supportedModels()
    return normalizeCommandCatalog(commands, models)
  } finally {
    stream.close()
  }
}
