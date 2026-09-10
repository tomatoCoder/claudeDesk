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

export function serializeBridgeEvent(event: BridgeEvent): string {
  return `${JSON.stringify(event)}\n`
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')
}
