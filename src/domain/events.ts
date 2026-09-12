export type TaskStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'awaiting_permission'
  | 'stopping'
  | 'completed'
  | 'interrupted'
  | 'failed'

export type PermissionDecisionKind = 'allow_once' | 'allow_task' | 'deny'

export interface UserQuestionOption {
  label: string
  description: string
  preview?: string | null
}

export interface UserQuestion {
  question: string
  header: string
  options: UserQuestionOption[]
  multiSelect: boolean
}

export type TaskEventData =
  | { kind: 'user_message'; text: string }
  | { kind: 'assistant_delta'; messageId: string; text: string }
  | { kind: 'assistant_message'; messageId: string; markdown: string }
  | { kind: 'tool_started'; toolUseId: string; toolName: string; input: unknown }
  | { kind: 'tool_finished'; toolUseId: string; output: unknown; isError: boolean }
  | { kind: 'permission_requested'; requestId: string; toolName: string; input: unknown; suggestions: unknown[] }
  | { kind: 'permission_resolved'; requestId: string; decision: PermissionDecisionKind }
  | { kind: 'question_requested'; requestId: string; questions: UserQuestion[] }
  | { kind: 'workspace_conflict'; projectId: string; activeTaskIds: string[] }
  | { kind: 'status_changed'; status: TaskStatus }
  | { kind: 'result'; sessionId: string; costUsd: number | null; turns: number | null }
  | { kind: 'local_command_output'; content: string }
  | { kind: 'error'; code: string; message: string; recoverable: boolean }
  | { kind: 'unknown'; raw: unknown }

interface TaskEventEnvelope {
  version: 1
  taskId: string
  runId: string
  sequence: number
  createdAt: string
}

type EventData<K extends TaskEventData['kind']> = Omit<Extract<TaskEventData, { kind: K }>, 'kind'>

export type TaskEvent = {
  [K in TaskEventData['kind']]: TaskEventEnvelope & { kind: K; data: EventData<K> }
}[TaskEventData['kind']]

export function isTaskEvent(value: unknown): value is TaskEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return event.version === 1
    && typeof event.taskId === 'string'
    && typeof event.runId === 'string'
    && Number.isInteger(event.sequence)
    && typeof event.createdAt === 'string'
    && typeof event.kind === 'string'
    && !!event.data
    && typeof event.data === 'object'
}
