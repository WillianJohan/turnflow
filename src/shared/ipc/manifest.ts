// Nome e kind de cada canal, sem zod: é o que o preload (sandbox, sem npm) precisa pra montar
// window.turnflow. Espelho de CHANNELS — contracts.test.ts falha se divergir.
import type { Channels } from './registry'

export const MANIFEST = {
  listTasks: ['tasks:list', 'invoke'],
  tasksRoot: ['tasks:root', 'invoke'],
  plan: ['task:plan', 'invoke'],
  readme: ['task:readme', 'invoke'],
  sessionInfo: ['task:sessions', 'invoke'],
  start: ['pty:start', 'invoke'],
  startUpdate: ['pty:startUpdate', 'invoke'],
  startScratch: ['pty:startScratch', 'invoke'],
  write: ['pty:write', 'send'],
  send: ['pty:send', 'invoke'],
  resize: ['pty:resize', 'send'],
  kill: ['pty:kill', 'send'],
  focusWindow: ['win:focus', 'send'],
  settingsPath: ['settings:path', 'invoke'],
  headerCached: ['header:cached', 'invoke'],
  header: ['header:get', 'invoke'],
  config: ['config:get', 'invoke'],
  setConfig: ['config:set', 'invoke'],
  cloneTheme: ['config:cloneTheme', 'invoke'],
  openConfigDir: ['config:openDir', 'send'],
  readTheme: ['theme:read', 'invoke'],
  saveTheme: ['theme:save', 'invoke'],
  deleteTheme: ['theme:delete', 'invoke'],
  fonts: ['fonts:list', 'invoke'],
  readClipboard: ['clip:read', 'invoke'],
  writeClipboard: ['clip:write', 'send']
} as const satisfies { [K in keyof Channels]: readonly [string, Channels[K]['kind']] }
