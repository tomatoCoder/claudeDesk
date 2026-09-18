import { spawn } from 'node:child_process'

const env = { ...process.env, CLAUDE_DESK_RENDERER_URL: 'http://127.0.0.1:1420' }
const vite = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1'], { stdio: 'inherit', env })
let electron

let rendererReady = false
for (let attempt = 0; attempt < 100; attempt += 1) {
  try { const response = await fetch(env.CLAUDE_DESK_RENDERER_URL); if (response.ok) { rendererReady = true; break } } catch {}
  await new Promise(resolve => setTimeout(resolve, 100))
}
if (!rendererReady) {
  vite.kill()
  throw new Error(`Vite renderer did not start at ${env.CLAUDE_DESK_RENDERER_URL}`)
}
electron = spawn('pnpm', ['exec', 'electron', '.'], { stdio: 'inherit', env })
const stop = () => { electron?.kill(); vite.kill() }
process.on('SIGINT', stop); process.on('SIGTERM', stop)
electron.on('exit', code => { vite.kill(); process.exitCode = code ?? 0 })
