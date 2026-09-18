import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ALLOWED_COMMANDS, IPC_CHANNELS, type DesktopInvokeRequest, type OpenFilesOptions } from '../shared/contracts.js'

type CommandHandler = (args: Record<string, unknown>, event: IpcMainInvokeEvent) => unknown | Promise<unknown>

const handlers = new Map<string, CommandHandler>()

export function registerCommand(command: string, handler: CommandHandler) {
  if (!ALLOWED_COMMANDS.has(command as never)) throw new Error(`IPC command is not allowlisted: ${command}`)
  handlers.set(command, handler)
}

export function registerIpcHandlers(mainWindow: BrowserWindow) {
  ipcMain.removeHandler(IPC_CHANNELS.invoke)
  ipcMain.removeHandler(IPC_CHANNELS.openFiles)
  ipcMain.handle(IPC_CHANNELS.invoke, async (event, request: DesktopInvokeRequest) => {
    assertTrustedRenderer(event, mainWindow)
    if (!request || typeof request.command !== 'string' || !ALLOWED_COMMANDS.has(request.command as never)) {
      throw new Error('不支持的桌面命令')
    }
    const handler = handlers.get(request.command)
    if (!handler) throw new Error(`桌面命令尚未迁移：${request.command}`)
    return handler(request.args ?? {}, event)
  })

  ipcMain.handle(IPC_CHANNELS.openFiles, async (event, options: OpenFilesOptions = {}) => {
    assertTrustedRenderer(event, mainWindow)
    const properties: Array<'openDirectory' | 'openFile' | 'multiSelections'> = [options.directory ? 'openDirectory' : 'openFile']
    if (options.multiple) properties.push('multiSelections')
    const result = await dialog.showOpenDialog(mainWindow, { title: options.title, properties })
    if (result.canceled || result.filePaths.length === 0) return null
    return options.multiple ? result.filePaths : result.filePaths[0]
  })
}

function assertTrustedRenderer(event: IpcMainInvokeEvent, mainWindow: BrowserWindow) {
  if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('拒绝非主界面的桌面调用')
  }
}
