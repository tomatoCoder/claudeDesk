export type PermissionDecision = 'allow_once' | 'allow_task' | 'deny'

export interface ResolvePermissionInput {
  taskId: string
  requestId: string
  decision: PermissionDecision
  updatedInput: unknown
  permissionUpdate?: unknown
}
