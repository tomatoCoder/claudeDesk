import type { TaskStatus } from './events'

export interface ProjectDto {
  id: string
  name: string
  path: string
  createdAt: string
  lastOpenedAt: string
}

export interface TaskDto {
  id: string
  projectId: string
  title: string
  claudeSessionId: string | null
  status: TaskStatus
  createdAt: string
  updatedAt: string
}

export interface AppSettingsDto {
  claudePath: string | null
  sidebarWidth: number
  theme: ThemePreference
  language: AppLanguage
  openWith: ProjectOpenWith
  permissionMode: AppPermissionMode
}

export type ThemePreference = 'system' | 'dark' | 'light'
export type AppLanguage = 'zh-CN' | 'en-US'
export type ProjectOpenWith = 'default' | 'qoder' | 'vscode' | 'intellij_idea'
export type AppPermissionMode = 'default' | 'auto' | 'bypass'

export interface ManagedClaudeSettings {
  authToken: string
  baseUrl: string
  model: string
  autoCompact: boolean
  autoCompactThreshold: string
  autoCompactWindow: string
}

export interface ClaudeSettingsDto {
  values: ManagedClaudeSettings
  raw: string
  version: string
  path: string
}

export interface SaveClaudeSettingsInput {
  version: string
  values: ManagedClaudeSettings
}

export interface SaveClaudeSettingsJsonInput {
  version: string
  raw: string
}

export interface ClaudeSessionMessage {
  type: 'user' | 'assistant' | 'system'
  uuid: string
  sessionId: string
  message: unknown
}

export type CliDiagnosticStatus = 'ready' | 'not_found' | 'too_old' | 'probe_failed' | 'not_authenticated'

export interface CliDiagnosticDto {
  status: CliDiagnosticStatus
  path: string | null
  version: string | null
  message: string
}

export interface AppSnapshot {
  projects: ProjectDto[]
  tasks: TaskDto[]
  settings: AppSettingsDto
  cli: CliDiagnosticDto
}

export interface RunAccepted { runId: string }

export interface QueuedTurnDto {
  id: string
  taskId: string
  text: string
  createdAt: string
}

export type TurnSubmission =
  | { kind: 'started'; runId: string }
  | { kind: 'queued'; queuedTurn: QueuedTurnDto }

export interface QueuedTurnsChanged {
  taskId: string
  queuedTurns: QueuedTurnDto[]
}

export interface CommandError {
  code: string
  message: string
  recoverable: boolean
  correlationId: string
}

export interface GitFileStatus {
  path: string
  status: string
  staged: boolean
}

export interface WorkspaceDiff {
  isRepository: boolean
  branch: string | null
  files: GitFileStatus[]
  patch: string
  truncated: boolean
}
