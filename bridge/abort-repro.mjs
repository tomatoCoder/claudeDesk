#!/usr/bin/env node
// Reproduce: start a query, abort it mid-run, dump every SDK event received.
import { query } from '@anthropic-ai/claude-agent-sdk'

const abortController = new AbortController()
const options = {
  cwd: '/tmp/abort-test',
  pathToClaudeCodeExecutable: '/Users/lealchen/.nvm/versions/node/v24.14.0/bin/claude',
  includePartialMessages: true,
  permissionMode: 'default',
  settingSources: ['user'],
  abortController,
  model: 'glm-5.3',
}

const timer = setTimeout(() => {
  console.error('=== ABORTING NOW ===')
  abortController.abort()
}, 4000)

try {
  const stream = query({ prompt: '请从 1 慢慢数到 100，每个数字之间思考一下', options })
  for await (const message of stream) {
    const brief = JSON.stringify(message)
    console.error(`EVENT ${String(message.type).padEnd(14)} ${brief.slice(0, 400)}`)
  }
  console.error('=== STREAM ENDED NORMALLY ===')
} catch (error) {
  console.error('=== THROWN ===', error instanceof Error ? error.message : String(error))
} finally {
  clearTimeout(timer)
}
