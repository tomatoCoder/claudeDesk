import { spawnSync } from 'node:child_process'

const target = process.argv[2]
const args = ['--config', 'electron-builder.yml']
if (target === 'mac') args.push('--mac', ...process.argv.slice(3))
else if (target === 'windows') args.push('--win', '--x64')
else throw new Error('目标必须是 mac 或 windows')
if (target === 'mac' && process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) args.push('--config.mac.notarize=true')
const build = spawnSync('pnpm', ['build'], { stdio: 'inherit' })
if (build.status) process.exit(build.status)
const result = spawnSync(process.execPath, ['scripts/electron-builder-compat.cjs', ...args], { stdio: 'inherit', env: process.env })
process.exit(result.status ?? 1)
