import { AppError } from '../../shared/errors.js'
import type { PermissionDecision, ResolvePermissionInput } from './contracts.js'

interface PendingPermission {
  taskId: string
  runId: string
  requestId: string
  send: (control: Record<string, unknown>) => void
}

export class PermissionCoordinator {
  private readonly pending = new Map<string, PendingPermission>()

  add(request: PendingPermission) {
    const key = this.key(request.taskId, request.requestId)
    if (this.pending.has(key)) throw new AppError('permission_duplicate', '权限请求标识重复', false)
    this.pending.set(key, request)
  }

  resolve(input: ResolvePermissionInput): PermissionDecision {
    if (!['allow_once', 'allow_task', 'deny'].includes(input.decision)) throw new AppError('permission_decision_invalid', '不支持的权限决定', true)
    const key = this.key(input.taskId, input.requestId)
    const request = this.pending.get(key)
    if (!request) throw new AppError('permission_not_found', '权限请求不存在或已经处理', true)
    this.pending.delete(key)
    request.send({
      v: 1,
      type: 'permission.resolve',
      runId: request.runId,
      permissionId: request.requestId,
      behavior: input.decision === 'deny' ? 'deny' : 'allow',
      ...(input.decision === 'deny' ? { message: '用户拒绝了此操作' } : { updatedInput: input.updatedInput }),
      ...(input.decision === 'allow_task' && input.permissionUpdate !== undefined ? { updatedPermissions: [input.permissionUpdate] } : {}),
    })
    return input.decision
  }

  cancelTask(taskId: string) {
    for (const [key, request] of this.pending) {
      if (request.taskId !== taskId) continue
      try { request.send({ v: 1, type: 'permission.resolve', runId: request.runId, permissionId: request.requestId, behavior: 'deny', message: '任务已结束' }) } catch { /* Worker has already exited. */ }
      this.pending.delete(key)
    }
  }

  private key(taskId: string, requestId: string) { return `${taskId}:${requestId}` }
}
