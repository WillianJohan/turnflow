import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openTestDb, tmpDir } from '../core/testing/db'
import type { Db } from '../core/db/open'
import type { TaskDetail, TaskRow } from '../shared/contracts'
import { CHANNELS } from '../shared/ipc/registry'
import type { Result } from '../shared/ipc/result'

// Mesmos stubs do ipc.coverage.test.ts; aqui o config.json é real (TURNFLOW_CONFIG_DIR = tmp).
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  ipcMain: {},
  clipboard: {},
  shell: {},
  BrowserWindow: class {
    static getAllWindows = (): unknown[] => []
  }
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
  watchConfig: () => () => undefined
}))

type Call = (method: keyof typeof CHANNELS, input?: unknown) => Promise<Result<unknown>>

const data = <T>(r: Result<unknown>): T => {
  if (!r.ok) throw new Error(`esperava ok, veio ${r.error.code}: ${r.error.message}`)
  return r.data as T
}

let dir: string
let db: Db
let dispose: () => void
let call: Call

beforeEach(async () => {
  dir = tmpDir()
  vi.stubEnv('TURNFLOW_CONFIG_DIR', dir)
  db = openTestDb()
  const { registerIpc } = await import('./ipc')
  const invokes = new Map<string, (...a: unknown[]) => unknown>()
  const ipc = {
    handle: (name: string, fn: (...a: unknown[]) => unknown) => void invokes.set(name, fn),
    on: () => undefined
  }
  const win = {
    webContents: { id: 1, on: () => undefined, send: () => undefined },
    isDestroyed: () => false
  }
  dispose = await registerIpc(win as never, ipc as never, {
    vault: { db: () => db } as never,
    version: '0.0.0',
    dialogs: { save: async () => null, open: async () => null },
    domain: { now: () => new Date('2026-10-22T12:00:00.000Z') }
  })
  call = async (method, input) =>
    (await invokes.get(CHANNELS[method].name)!(
      { sender: { id: 1 } },
      ...(input === undefined ? [] : [input])
    )) as Result<unknown>
})

afterEach(() => {
  dispose()
  db.close()
  vi.unstubAllEnvs()
})

const cfgFile = (): string => join(dir, 'config.json')

describe('config.json × pasta padrão', () => {
  it('config:set com defaultWorkdir relativo é VALIDATION e não toca o config.json', async () => {
    const before = await readFile(cfgFile(), 'utf8')
    expect(await call('setConfig', { defaultWorkdir: 'rel' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    expect(await call('setConfig', { defaultWorkdir: '' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    expect(await readFile(cfgFile(), 'utf8')).toBe(before)
    expect(data(await call('setConfig', { defaultWorkdir: '/abs' }))).toMatchObject({
      config: { defaultWorkdir: '/abs' }
    })
    expect(data(await call('setConfig', { defaultWorkdir: null }))).toMatchObject({
      config: { defaultWorkdir: null }
    })
  })

  it('JSON inválido mantém a pasta padrão anterior; JSON válido troca', async () => {
    data(await call('setConfig', { defaultWorkdir: '/abs' }))
    const row = data<{ row: TaskRow }>(await call('taskCreate', { title: 'a' })).row
    const effective = async (): Promise<string | null> =>
      data<TaskDetail>(await call('taskGet', { id: row.id })).workdir_effective
    expect(await effective()).toBe('/abs')

    await writeFile(cfgFile(), '{ quebrado')
    expect(data<{ error?: string }>(await call('config')).error).toBeDefined()
    expect(await effective()).toBe('/abs')

    await writeFile(cfgFile(), JSON.stringify({ defaultWorkdir: '/outra' }))
    data(await call('config'))
    expect(await effective()).toBe('/outra')
  })
})
