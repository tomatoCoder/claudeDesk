import fs from 'node:fs'
import path from 'node:path'

export function backupDatabase(databasePath: string) {
  if (!fs.existsSync(databasePath)) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(path.dirname(databasePath), `${path.basename(databasePath)}.${stamp}.bak`)
  fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL)
  for (const suffix of ['-wal', '-shm']) {
    const source = `${databasePath}${suffix}`
    if (fs.existsSync(source)) fs.copyFileSync(source, `${backupPath}${suffix}`, fs.constants.COPYFILE_EXCL)
  }
  return backupPath
}
