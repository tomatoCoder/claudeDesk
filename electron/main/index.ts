import { app } from 'electron'
import fs from 'node:fs'
import { registerCommand, registerIpcHandlers } from './ipc.js'
import { createMainWindow, loadMainWindow } from './window.js'
import { resolveAppPaths } from './app-paths.js'
import { Storage } from './database/storage.js'
import { registerStorageCommands } from './database/commands.js'
import { registerSessionCommands } from './sessions/commands.js'
import { ClaudeSettingsRepository } from './settings/claude-settings.js'
import { registerClaudeSettingsCommands } from './settings/commands.js'
import { TaskCoordinator } from './tasks/coordinator.js'
import { registerTaskCommands } from './tasks/commands.js'
import { registerFileCommands } from './files/commands.js'
import { registerSystemCommands } from './system/commands.js'
import { LogStore } from './diagnostics/log-store.js'
import { registerDiagnosticCommands } from './diagnostics/commands.js'
import { registerClaudeCommands } from './claude/commands.js'
import { BrowserManager } from './browser/manager.js'
import { registerBrowserCommands } from './browser/commands.js'
import { BrowserAnnotationStore } from './browser/annotations.js'

let quitting = false
const paths = resolveAppPaths()
fs.mkdirSync(paths.dataDir, { recursive: true })
app.setPath('userData', paths.dataDir)

app.whenReady().then(async () => {
  const storage = new Storage(paths.database)
  const logs = new LogStore(paths.logs)
  storage.recoverInterruptedTasks()
  registerStorageCommands(storage)
  registerFileCommands(storage)
  registerSystemCommands(storage)
  registerDiagnosticCommands(storage, logs)
  registerClaudeCommands(storage)
  registerSessionCommands(storage)
  const claudeSettings = new ClaudeSettingsRepository()
  registerClaudeSettingsCommands(claudeSettings)
  const mainWindow = createMainWindow()
  const annotations = new BrowserAnnotationStore()
  const browser = new BrowserManager(mainWindow, annotations)
  registerBrowserCommands(browser, annotations)
  const coordinator = new TaskCoordinator(storage, claudeSettings, mainWindow, logs)
  registerTaskCommands(coordinator)
  registerCommand('confirm_app_exit', () => { quitting = true; coordinator.shutdown(); app.quit() })
  registerIpcHandlers(mainWindow)
  await loadMainWindow(mainWindow)

  mainWindow.on('close', (event) => {
    if (quitting || coordinator.activeTaskIds().length === 0) return
    event.preventDefault()
    mainWindow.webContents.send('claude-desk:event:app-exit-requested', coordinator.activeTaskIds())
  })

  app.on('before-quit', () => { browser.destroy(); coordinator.shutdown() })

})

app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => {
  app.quit()
})
