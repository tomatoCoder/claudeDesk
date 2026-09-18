import path from 'node:path'
import os from 'node:os'

export interface AppPaths {
  dataDir: string
  database: string
  logs: string
}

export function resolveAppPaths(): AppPaths {
  const dataDir = process.env.CLAUDE_DESK_DATA_DIR || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'com.claudedesk.desktop')
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'com.claudedesk.desktop')
      : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'com.claudedesk.desktop'))
  return {
    dataDir,
    database: path.join(dataDir, 'claude-desk.db'),
    logs: path.join(dataDir, 'logs'),
  }
}
