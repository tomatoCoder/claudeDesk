#!/usr/bin/env node
// Abort DURING a tool call; dump every event, full JSON for assistant events.
import { query } from '@anthropic-ai/claude-agent-sdk'

const abortController = new AbortController()
const options = {
  cwd: '/tmp/abort-test',
  pathToClaudeCodeExecutable: '/Users/lealchen/.nvm/versions/node/v24.14.0/bin/claude',
  includePartialMessages: true,
  permissionMode: 'bypassPermissions',
  settingSources: ['user'],
  model: 'glm-5.3',
  abortController,
}

const timer = setTimeout(() => {
  console.error('=== ABORTING NOW ===')
  abortController.abort()
}, 9000)

try {
  const stream = query({ prompt: '请用 Bash 工具执行 "sleep 60" 然后告诉我结果', options })
  for await (const message of stream) {
    if (message.type === 'stream_event' && message.event?.type === 'content_block_delta') continue
    console.error(`EVENT ${String(message.type).padEnd(12)} ${JSON.stringify(message).slice(0, 1500)}`)
  }
  console.error('=== STREAM ENDED NORMALLY ===')
} catch (error) {
  console.error('=== THROWN ===', error instanceof Error ? error.message : String(error))
} finally {
  clearTimeout(timer)
}
