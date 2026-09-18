import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const release = path.resolve('release')
if (!existsSync(release)) throw new Error('release 目录不存在，请先执行打包')
const artifacts = readdirSync(release).filter(name => /\.(dmg|zip|exe)$/i.test(name))
const directoryBundles = readdirSync(release).filter(name => existsSync(path.join(release, name, 'Claude Desk.app')))
if (!artifacts.length && !directoryBundles.length) throw new Error('未找到 Electron 安装产物')
for (const name of [...artifacts, ...directoryBundles]) console.log(name)
