import { session } from 'electron'

export function browserSession() {
  const value = session.fromPartition('persist:claude-desk-browser', { cache: true })
  value.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  value.setPermissionCheckHandler(() => false)
  return value
}
