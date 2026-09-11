export const PROTOCOL_VERSION = 1 as const

export interface HandshakeRequest {
  v: typeof PROTOCOL_VERSION
  type: 'handshake'
  requestId: string
  claudePath: string
}

export interface CatalogRequest {
  v: typeof PROTOCOL_VERSION
  type: 'catalog.list' | 'catalog.messages' | 'catalog.rename'
  requestId: string
  claudePath: string
  cwd?: string
  sessionId?: string
  title?: string
}

export interface RunStartRequest {
  v: typeof PROTOCOL_VERSION
  type: 'run.start'
  requestId: string
  runId: string
  claudePath: string
  cwd: string
  prompt: string
  sessionId?: string
  model?: string
}

export type BridgeRequest = HandshakeRequest | CatalogRequest | RunStartRequest

export type RunControl =
  | { v: 1; type: 'run.stop'; runId: string }
  | { v: 1; type: 'run.adjust'; runId: string; adjustmentId: string; text: string }
  | { v: 1; type: 'permission.resolve'; runId: string; permissionId: string; behavior: 'allow' | 'deny'; updatedInput?: unknown; updatedPermissions?: unknown[]; message?: string }

export interface BridgeEvent {
  v: typeof PROTOCOL_VERSION
  type: string
  requestId: string
  runId?: string
  sequence?: number
  [key: string]: unknown
}

export function parseBridgeRequest(line: string): BridgeRequest {
  const value = JSON.parse(line) as Record<string, unknown>
  if (value.v !== PROTOCOL_VERSION) throw new Error('不支持的 Bridge 协议版本')
  if (typeof value.type !== 'string' || typeof value.requestId !== 'string' || !value.requestId) {
    throw new Error('Bridge 请求缺少 type 或 requestId')
  }
  if (typeof value.claudePath !== 'string' || !isAbsolutePath(value.claudePath)) {
    throw new Error('Claude 可执行文件必须使用绝对路径')
  }
  return value as unknown as BridgeRequest
}

export function parseRunControl(line: string): RunControl {
  const value = JSON.parse(line) as Record<string, unknown>
  if (value.v !== PROTOCOL_VERSION || typeof value.type !== 'string' || typeof value.runId !== 'string') {
    throw new Error('运行控制消息格式无效')
  }
  if (value.type === 'run.adjust') {
    if (typeof value.adjustmentId !== 'string' || !value.adjustmentId) throw new Error('调整消息缺少 adjustmentId')
    if (typeof value.text !== 'string' || !value.text.trim()) throw new Error('调整消息不能为空')
    if (value.text.length > 200_000) throw new Error('调整消息长度超过 200,000 个字符')
  }
  if (value.type === 'permission.resolve' && (typeof value.permissionId !== 'string' || !value.permissionId)) {
    throw new Error('权限控制消息缺少 permissionId')
  }
  if (!['run.stop', 'run.adjust', 'permission.resolve'].includes(value.type)) throw new Error('未知运行控制消息')
  return value as unknown as RunControl
}

export function serializeBridgeEvent(event: BridgeEvent): string {
  return `${JSON.stringify(event)}\n`
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')
}
