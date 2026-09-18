// electron-builder 26.15.x calls the newer @electron/get cache enum while
// resolving the older CommonJS @electron/get 3.x dependency. Fill in the
// enum at the module boundary so packaging remains reproducible until the
// upstream dependency contract is corrected.
const Module = require('node:module')
const originalLoad = Module._load
Module._load = function load(request, parent, isMain) {
  const value = originalLoad.call(this, request, parent, isMain)
  if (request === '@electron/get' && value && !value.ElectronDownloadCacheMode) {
    value.ElectronDownloadCacheMode = { ReadWrite: 0, ReadOnly: 1, WriteOnly: 2, Bypass: 3, 0: 'ReadWrite', 1: 'ReadOnly', 2: 'WriteOnly', 3: 'Bypass' }
  }
  return value
}
require('electron-builder/cli.js')
