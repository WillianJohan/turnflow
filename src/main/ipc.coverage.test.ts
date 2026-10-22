import { describe, expect, it, vi } from 'vitest'
import { CHANNELS } from '../shared/ipc/registry'

// Tudo que toca disco, processo ou Electron vira stub: o teste só olha a fiação dos canais.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  ipcMain: {},
  clipboard: {},
  shell: {},
  BrowserWindow: class {}
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('./pty', () => ({
  alivePtys: () => [],
  killAll: () => undefined,
  killPty: () => undefined,
  ownPids: () => new Set(),
  renamePty: () => false,
  resizePty: () => undefined,
  startPty: () => undefined,
  writePty: () => undefined
}))
vi.mock('./tasks', () => ({ loadTasks: async () => [], watchTasks: () => () => undefined }))
vi.mock('./hooks', () => ({
  startHookServer: async () => ({ port: 1, token: 't', close: () => undefined }),
  writeHookSettings: async () => '/tmp/settings.json'
}))
vi.mock('./appConfig', async (orig) => ({
  ...(await orig<typeof import('./appConfig')>()),
  ensureDefaults: async () => undefined,
  watchConfig: () => () => undefined
}))

describe('registerIpc', () => {
  it('registra um handler para cada canal do registro, e só eles', async () => {
    const { registerIpc } = await import('./ipc')
    const handled: string[] = []
    const ipc = {
      handle: (name: string) => void handled.push(name),
      on: (name: string) => void handled.push(name)
    }
    const win = {
      webContents: { id: 1, on: () => undefined, send: () => undefined },
      isDestroyed: () => false
    }
    const dispose = await registerIpc(win as never, ipc as never)
    dispose()
    const expected = Object.values(CHANNELS).map((c) => c.name)
    expect(handled.sort()).toEqual(expected.sort())
    expect(new Set(handled).size).toBe(handled.length) // nenhum registrado duas vezes
  })
})
