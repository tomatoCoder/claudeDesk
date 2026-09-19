import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const target = process.argv[2]
const args = ['--config', 'electron-builder.yml']
if (target === 'mac') args.push('--mac', ...process.argv.slice(3))
else if (target === 'windows') args.push('--win', '--x64')
else throw new Error('目标必须是 mac 或 windows')
if (target === 'mac' && process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) args.push('--config.mac.notarize=true')
const build = spawnSync('pnpm', ['build'], { stdio: 'inherit' })
if (build.status) process.exit(build.status)

const packagedBridge = path.resolve('bridge/packaged')
rmSync(packagedBridge, { recursive: true, force: true })
mkdirSync(path.join(packagedBridge, 'node_modules', '@anthropic-ai'), { recursive: true })
cpSync(path.resolve('bridge/dist'), path.join(packagedBridge, 'dist'), { recursive: true })
writeFileSync(path.join(packagedBridge, 'package.json'), readFileSync(path.resolve('bridge/package.json')))

const sdkSource = path.dirname(path.resolve('bridge/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'))
const sdkTarget = path.join(packagedBridge, 'node_modules', '@anthropic-ai', 'claude-agent-sdk')
mkdirSync(sdkTarget, { recursive: true })
for (const entry of readdirSync(sdkSource, { withFileTypes: true })) {
  if (entry.name === 'node_modules') continue
  cpSync(path.join(sdkSource, entry.name), path.join(sdkTarget, entry.name), { recursive: true, dereference: true })
}

const result = spawnSync(process.execPath, ['scripts/electron-builder-compat.cjs', ...args], { stdio: 'inherit', env: process.env })
process.exit(result.status ?? 1)
