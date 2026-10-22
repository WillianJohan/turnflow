import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
import type { DkApi } from './api'

const on =
  <A extends unknown[]>(ch: string) =>
  (cb: (...a: A) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, ...a: unknown[]): void => cb(...(a as A))
    ipcRenderer.on(ch, h)
    return () => ipcRenderer.off(ch, h)
  }

const dk: DkApi = {
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  onTasksChanged: on('tasks:changed'),
  plan: (id, uuid) => ipcRenderer.invoke('task:plan', id, uuid),
  start: (id, how, c, r) => ipcRenderer.invoke('pty:start', id, how, c, r),
  startUpdate: (c, r) => ipcRenderer.invoke('pty:startUpdate', c, r),
  tasksRoot: () => ipcRenderer.invoke('tasks:root'),
  focusWindow: () => ipcRenderer.send('win:focus'),
  readme: (id) => ipcRenderer.invoke('task:readme', id),
  startScratch: (id, c, r) => ipcRenderer.invoke('pty:startScratch', id, c, r),
  write: (id, d) => ipcRenderer.send('pty:write', id, d),
  send: (id, d) => ipcRenderer.invoke('pty:send', id, d),
  resize: (id, c, r) => ipcRenderer.send('pty:resize', id, c, r),
  kill: (id) => ipcRenderer.send('pty:kill', id),
  onData: on('pty:data'),
  onExit: on('pty:exit'),
  onState: on('pty:state'),
  onRenamed: on('pty:renamed'),
  sessionInfo: (id) => ipcRenderer.invoke('task:sessions', id),
  settingsPath: () => ipcRenderer.invoke('settings:path'),
  headerCached: (id) => ipcRenderer.invoke('header:cached', id),
  pathForFile: (f) => webUtils.getPathForFile(f),
  config: () => ipcRenderer.invoke('config:get'),
  setConfig: (p) => ipcRenderer.invoke('config:set', p),
  cloneTheme: (from) => ipcRenderer.invoke('config:cloneTheme', from),
  openConfigDir: () => ipcRenderer.send('config:openDir'),
  fonts: () => ipcRenderer.invoke('fonts:list'),
  readTheme: (id) => ipcRenderer.invoke('theme:read', id),
  saveTheme: (id, t) => ipcRenderer.invoke('theme:save', id, t),
  deleteTheme: (id) => ipcRenderer.invoke('theme:delete', id),
  onConfig: on('config:changed'),
  clipboard: {
    read: () => ipcRenderer.invoke('clip:read'),
    writeText: (t) => ipcRenderer.send('clip:write', t)
  },
  header: (id, force) => ipcRenderer.invoke('header:get', id, force)
}
contextBridge.exposeInMainWorld('dk', dk)

// dev: TURNFLOW_SHOT_LAYOUT semeia o layout antes do app ler (prints automatizados)
if (process.env.TURNFLOW_SHOT_LAYOUT)
  localStorage.setItem('turnflow.layout', process.env.TURNFLOW_SHOT_LAYOUT)
