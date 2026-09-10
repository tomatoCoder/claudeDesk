import type { SDKSessionInfo, SessionMessage } from '@anthropic-ai/claude-agent-sdk'

export interface SessionSummary {
  sessionId: string
  title: string
  lastModified: number
  cwd: string | null
  gitBranch: string | null
  createdAt: number | null
  fileSize: number | null
}

export function normalizeSession(session: SDKSessionInfo): SessionSummary {
  return {
    sessionId: session.sessionId,
    title: session.customTitle || session.summary || session.firstPrompt || '未命名会话',
    lastModified: session.lastModified,
    cwd: session.cwd ?? null,
    gitBranch: session.gitBranch ?? null,
    createdAt: session.createdAt ?? null,
    fileSize: session.fileSize ?? null,
  }
}

export function normalizeSessionMessage(message: SessionMessage) {
  return {
    type: message.type,
    uuid: message.uuid,
    sessionId: message.session_id,
    message: message.message,
  }
}
