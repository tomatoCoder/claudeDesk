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
