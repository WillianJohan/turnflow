import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
import { MANIFEST } from '../shared/ipc/manifest'
import { EVENTS } from '../shared/ipc/events'
import type { RendererApi } from '../shared/ipc/api'

// window.turnflow gerado do registro. Sem zod aqui (sandbox não carrega npm): quem valida é o main.
const api: Record<string, unknown> = {}
for (const [method, [channel, kind]] of Object.entries(MANIFEST))
  api[method] =
    kind === 'send'
      ? (input: unknown) => ipcRenderer.send(channel, input)
      : (input: unknown) => ipcRenderer.invoke(channel, input)

for (const [method, channel] of Object.entries(EVENTS))
  api[method] = (cb: (...a: unknown[]) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, ...a: unknown[]): void => cb(...a)
    ipcRenderer.on(channel, h)
    return () => ipcRenderer.off(channel, h)
  }

api.pathForFile = (f: File) => webUtils.getPathForFile(f)

contextBridge.exposeInMainWorld('turnflow', api as RendererApi)
