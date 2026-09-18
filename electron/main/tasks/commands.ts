import { AppError } from '../../shared/errors.js'
import { registerCommand } from '../ipc.js'
import type { TaskCoordinator } from './coordinator.js'

export function registerTaskCommands(coordinator: TaskCoordinator) {
  registerCommand('send_turn', async ({ taskId, prompt }) => { const result = await coordinator.submit(text(taskId), text(prompt), false); return { runId: result.runId } })
  registerCommand('submit_turn', ({ taskId, prompt }) => coordinator.submit(text(taskId), text(prompt), true))
  registerCommand('cancel_task', ({ taskId }) => coordinator.cancel(text(taskId)))
  registerCommand('list_queued_turns', ({ taskId }) => coordinator.listQueue(text(taskId)))
  registerCommand('update_queued_turn', ({ taskId, queuedTurnId, prompt }) => coordinator.updateQueue(text(taskId), text(queuedTurnId), text(prompt)))
  registerCommand('delete_queued_turn', ({ taskId, queuedTurnId }) => coordinator.deleteQueue(text(taskId), text(queuedTurnId)))
  registerCommand('adjust_queued_turn', ({ taskId, queuedTurnId }) => coordinator.adjustQueue(text(taskId), text(queuedTurnId)))
  registerCommand('send_queued_turn', ({ taskId, queuedTurnId }) => coordinator.sendQueued(text(taskId), text(queuedTurnId)))
  registerCommand('resolve_permission', ({ taskId, requestId, decision, updatedInput, permissionUpdate }) => coordinator.resolvePermission({ taskId: text(taskId), requestId: text(requestId), decision: permissionDecision(decision), updatedInput, permissionUpdate }))
}
function text(value: unknown) { if (typeof value !== 'string') throw new AppError('invalid_argument', '参数格式无效', true); return value }
function permissionDecision(value: unknown) { if (value === 'allow_once' || value === 'allow_task' || value === 'deny') return value; throw new AppError('permission_decision_invalid', '不支持的权限决定', true) }
