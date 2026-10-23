import type { WebPreferences } from 'electron'

// renderer sem Node e isolado; o preload só fala com o main por IPC
export const windowPrefs = (preload: string): WebPreferences => ({
  preload,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false
})
