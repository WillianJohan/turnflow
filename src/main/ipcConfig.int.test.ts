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
  nodePtySpawner: () => {
    throw new Error('sem node-pty no unit')
  },
  createPtyPool: () => ({
    start: () => undefined,
    write: () => undefined,
    resize: () => undefined,
    kill: () => undefined,
    killAndWait: async () => undefined,
    killAllAndWait: async () => undefined,
    alive: () => [],
    ownPids: () => new Set()
  })
}))
const legacy = vi.hoisted(() => ({
  load: vi.fn<(root: string) => Promise<unknown[]>>(async () => []),
  watch: vi.fn<(root: string, onChange: () => void) => () => void>(() => () => undefined)
}))
vi.mock('./tasks', () => ({ loadTasks: legacy.load, watchTasks: legacy.watch }))
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
let log: ReturnType<typeof vi.fn<(line: string) => void>>

beforeEach(async () => {
  dir = tmpDir()
  vi.stubEnv('TURNFLOW_CONFIG_DIR', dir)
  vi.stubEnv('TURNFLOW_BRAIN', '')
  legacy.load.mockReset().mockResolvedValue([])
  legacy.watch.mockReset().mockReturnValue(() => undefined)
  log = vi.fn()
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
  dispose = (
    await registerIpc(win as never, ipc as never, {
      vault: { db: () => db } as never,
      version: '0.0.0',
      dialogs: { save: async () => null, open: async () => null, folder: async () => null },
      domain: { now: () => new Date('2026-10-22T12:00:00.000Z') },
      log
    })
  ).dispose
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

describe('config.json × agents', () => {
  it('config:set com agents → VALIDATION e o arquivo não muda', async () => {
    const before = await readFile(cfgFile(), 'utf8')
    expect(
      await call('setConfig', { agents: { codex: 'x', cursor: 'y', other: null } })
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await readFile(cfgFile(), 'utf8')).toBe(before)
  })
})

describe('config.json × brain da lateral herdada', () => {
  it('brainDir novo rearma o watcher e a lateral lista dele', async () => {
    const brain = tmpDir()
    data(await call('setConfig', { brainDir: brain }))
    expect(legacy.watch).toHaveBeenLastCalledWith(brain, expect.any(Function))
    expect(legacy.load).toHaveBeenLastCalledWith(brain)
    expect(data(await call('tasksRoot'))).toBe(brain)
  })

  it('falha ao ler o brain novo não quebra a leitura de config', async () => {
    const brain = tmpDir()
    legacy.load.mockRejectedValueOnce(new Error('EACCES brain'))
    expect(data(await call('setConfig', { brainDir: brain }))).toMatchObject({
      config: { brainDir: brain }
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('EACCES brain'))
    expect(data(await call('tasksRoot'))).toBe(brain)
  })

  it('falha no reload disparado pelo watcher só vai pro log', async () => {
    const brain = tmpDir()
    data(await call('setConfig', { brainDir: brain }))
    const onChange = legacy.watch.mock.calls.at(-1)![1]
    legacy.load.mockRejectedValueOnce(new Error('pasta sumiu'))
    await expect(Promise.resolve(onChange())).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pasta sumiu'))
  })

  it('falha ao ler o brain no start não derruba o registerIpc', async () => {
    dispose()
    vi.stubEnv('TURNFLOW_BRAIN', tmpDir())
    const { registerIpc } = await import('./ipc')
    legacy.load.mockRejectedValueOnce(new Error('brain ilegível'))
    const win = {
      webContents: { id: 2, on: () => undefined, send: () => undefined },
      isDestroyed: () => false
    }
    const ipc = { handle: () => undefined, on: () => undefined }
    dispose = (
      await registerIpc(win as never, ipc as never, {
        vault: { db: () => db } as never,
        version: '0.0.0',
        dialogs: { save: async () => null, open: async () => null, folder: async () => null },
        domain: { now: () => new Date('2026-10-22T12:00:00.000Z') },
        log
      })
    ).dispose
    expect(log).toHaveBeenCalledWith(expect.stringContaining('brain ilegível'))
  })
})

describe('ui.json', () => {
  const file = {
    version: 1,
    layout: { panels: [{ tabs: ['T-1'], active: 0 }], focused: 0 },
    sidebar: { folded: false, width: 288 },
    home: 'list',
    fab: { edge: 'right', offset: 24 },
    density: 'normal'
  }

  it('ausente lê null; set grava e a leitura seguinte devolve o mesmo', async () => {
    expect(await call('uiGet')).toEqual({ ok: true, data: null })
    expect(data(await call('uiSet', file))).toEqual(file)
    expect(data(await call('uiGet'))).toEqual(file)
    expect(await readFile(join(dir, 'ui.json'), 'utf8')).toContain('"T-1"')
  })

  it('largura fora da faixa é VALIDATION e não grava', async () => {
    expect(await call('uiSet', { ...file, sidebar: { folded: false, width: 10 } })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    expect(await call('uiGet')).toEqual({ ok: true, data: null })
  })

  it('json quebrado lê null', async () => {
    await writeFile(join(dir, 'ui.json'), '{ quebrado')
    expect(await call('uiGet')).toEqual({ ok: true, data: null })
  })
})
