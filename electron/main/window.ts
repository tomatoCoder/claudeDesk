import { BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

export function createMainWindow() {
  const window = new BrowserWindow({
    title: 'Claude Desk',
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    center: true,
    resizable: true,
    fullscreen: false,
    show: false,
    backgroundColor: '#0b0b0a',
    webPreferences: {
      preload: path.join(currentDirectory, '../preload/main.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  return window
}

export async function loadMainWindow(window: BrowserWindow) {
  const developmentUrl = process.env.CLAUDE_DESK_RENDERER_URL
  if (developmentUrl) await window.loadURL(developmentUrl)
  else await window.loadFile(path.join(currentDirectory, '../../dist/index.html'))
  window.show()
}
