import { describe, expect, it } from 'vitest'
import type { Db } from '../../core/db/open'
import { createTask, updateTask } from '../../core/domain/task'
import type { Actor, DomainDeps } from '../../core/domain/context'
import { getSession } from '../../core/domain/session'
import { vaultPaths } from '../../core/key/paths'
import { createVault, type Vault } from '../../core/key/vault'
import { insertSession, tmpDir } from '../../core/testing/db'
import { fakeKeyBackend } from '../../core/testing/fakeKeyBackend'
import { CHANNELS } from '../../shared/ipc/registry'
import type { PtyProc, PtySpawner } from '../pty'
import { createPtyGuard } from '../ptyGuard'
import { createSessionHost, type SessionHost } from '../sessionHost'
import { domainCache } from './domain'
import { handle, type Handler, type IpcLike } from './handle'
import type { Channel } from '../../shared/ipc/define'
import { registerPtyIo } from './ptyIo'
import { registerSessionIpc } from './session'

const USER: Actor = { kind: 'user' }

type Fake = PtyProc & { emitExit(code?: number): void; writes: string[] }

function fakeSpawner(): { spawner: PtySpawner; procs: Fake[] } {
  const procs: Fake[] = []
  const spawner: PtySpawner = () => {
    let exit: (e: { exitCode: number }) => void = () => undefined
    const p: Fake = {
      // acima do pid_max do Linux (2^22): o SIGKILL do pool nunca acerta processo de verdade
      pid: 5_000_000 + procs.length,
      onData: () => undefined,
      onExit: (cb) => void (exit = cb),
      write: (d) => void p.writes.push(d),
      resize: () => undefined,
      kill: () => undefined,
      emitExit: (code = 0) => exit({ exitCode: code }),
      writes: []
    }
    procs.push(p)
    return p
  }
  return { spawner, procs }
}

async function readyVault(dir: string): Promise<Vault> {
  const vault = createVault({ paths: vaultPaths(dir), backend: fakeKeyBackend('real') })
  await vault.boot()
  await vault.beginFirstRun()
  await vault.commitFirstRun()
  return vault
}

function harness(
  vault: Vault,
  domainFor: (db: Db) => DomainDeps
): {
  host: SessionHost
  invoke: (name: string, input?: unknown, sender?: number) => Promise<unknown>
  send: (name: string, input: unknown, sender?: number) => void
  procs: Fake[]
} {
  const guard = createPtyGuard()
  const fake = fakeSpawner()
  const host = createSessionHost({
    spawner: fake.spawner,
    domain: () => {
      try {
        if (vault.state() !== 'ready') return null
        return domainFor(vault.db())
      } catch {
        return null
      }
    },
    bins: async () => ({
      claude: 'claude',
      codex: ['codex'],
      cursor: ['cursor-agent'],
      other: null
    }),
    path: async () => '/usr/bin',
    settingsPath: '/settings.json',
    socketPath: '/tmp/turnflow.sock',
    hookPort: () => 1,
    defaultWorkdir: () => null,
    home: '/srv/me',
    platform: 'linux',
    dirExists: async () => true,
    findTranscript: async () => ({ cwd: '/w' }),
    runningElsewhere: async () => null,
    events: {
      data: () => undefined,
      exit: (id) => guard.release(id),
      state: () => undefined
    },
    log: () => undefined,
    newToken: () => 'tok-1'
  })
  const invokes = new Map<string, (...a: unknown[]) => unknown>()
  const ons = new Map<string, (...a: unknown[]) => unknown>()
  const ipc = {
    handle: (name: string, fn: (...a: unknown[]) => unknown) => void invokes.set(name, fn),
    on: (name: string, fn: (...a: unknown[]) => unknown) => void ons.set(name, fn)
  } as unknown as IpcLike
  const h = <C extends Channel>(ch: C, fn: Handler<C>): void => handle(ipc, ch, fn)
  registerSessionIpc(h, {
    host,
    vault,
    domainFor,
    pickFolder: async () => '/picked',
    guard,
    owner: 1
  })
  registerPtyIo(ipc, { guard, pty: host, onKill: () => undefined })
  const event = (sender: number): { sender: { id: number } } => ({ sender: { id: sender } })
  return {
    host,
    procs: fake.procs,
    invoke: async (name, input, sender = 1) =>
      invokes.get(name)!(event(sender), ...(input === undefined ? [] : [input])),
    send: (name, input, sender = 1) => ons.get(name)!(event(sender), input)
  }
}

const domainForOf = (): ((db: Db) => DomainDeps) =>
  domainCache({
    now: () => new Date('2026-10-22T12:00:00.000Z'),
    defaultWorkdir: () => null,
    afterCommit: () => undefined
  })

describe('canais de sessão', () => {
  it('session.ofPty devolve a sessão atual do pty depois da fusão; de outra janela, null', async () => {
    const dir = tmpDir()
    const vault = await readyVault(dir)
    const forDb = domainForOf()
    const { invoke, host } = harness(vault, forDb)
    const d = forDb(vault.db())
    const U = '00000000-0000-4000-8000-000000000009'
    const old = insertSession(vault.db(), {
      task_id: null,
      state: 'idle',
      state_at: '2026-01-01T00:00:00.000Z',
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-02T00:00:00.000Z',
      external_id: U,
      tool: 'claude-code'
    })
    const spawned = (await invoke(CHANNELS.ptySpawn.name, {
      kind: 'agent',
      pty_id: 'p1',
      tool: 'claude-code',
      task: null,
      cols: 80,
      rows: 24
    })) as { ok: true; data: { session_id: string } }
    expect(spawned.ok).toBe(true)
    host.onHook('tok-1', { hook_event_name: 'SessionStart', session_id: U, cwd: '/w' })
    // a sessão que o spawn devolveu sumiu na fusão: quem pergunta pelo pty recebe a sobrevivente
    expect(getSession(d, spawned.data.session_id)).toBeNull()
    await expect(invoke(CHANNELS.sessionOfPty.name, { pty_id: 'p1' })).resolves.toEqual({
      ok: true,
      data: { session_id: old }
    })
    await expect(invoke(CHANNELS.sessionOfPty.name, { pty_id: 'p1' }, 2)).resolves.toEqual({
      ok: true,
      data: { session_id: null }
    })
    vault.close()
  })

  it('pty.spawn com input inválido → VALIDATION', async () => {
    const dir = tmpDir()
    const vault = await readyVault(dir)
    const { invoke } = harness(vault, domainForOf())
    await expect(invoke(CHANNELS.ptySpawn.name, { kind: 'agent' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    vault.close()
  })

  it('spawn sem pasta → CONFLICT com details.reason workdir_required', async () => {
    const dir = tmpDir()
    const vault = await readyVault(dir)
    const forDb = domainForOf()
    const { invoke } = harness(vault, forDb)
    const task = createTask(forDb(vault.db()), USER, { title: 'Ship' }).row!
    const res = await invoke(CHANNELS.ptySpawn.name, {
      kind: 'agent',
      pty_id: 'p1',
      tool: 'claude-code',
      task: task.id,
      cols: 80,
      rows: 24
    })
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', details: { reason: 'workdir_required' } }
    })
    vault.close()
  })

  it('spawn de task inexistente → NOT_FOUND', async () => {
    const dir = tmpDir()
    const vault = await readyVault(dir)
    const { invoke } = harness(vault, domainForOf())
    await expect(
      invoke(CHANNELS.ptySpawn.name, {
        kind: 'agent',
        pty_id: 'p1',
        tool: 'claude-code',
        task: 'T-404',
        cols: 80,
        rows: 24
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    vault.close()
  })

  it('spawn com vault travado → LOCKED', async () => {
    const vault = createVault({ paths: vaultPaths(tmpDir()), backend: fakeKeyBackend('real') })
    await vault.boot()
    const { invoke } = harness(vault, domainForOf())
    await expect(
      invoke(CHANNELS.ptySpawn.name, {
        kind: 'agent',
        pty_id: 'p1',
        tool: 'claude-code',
        task: 'T-1',
        cols: 80,
        rows: 24
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'LOCKED' } })
    vault.close()
  })

  it('session.list da task', async () => {
    const dir = tmpDir()
    const vault = await readyVault(dir)
    const forDb = domainForOf()
    const { invoke } = harness(vault, forDb)
    const d = forDb(vault.db())
    const task = createTask(d, USER, { title: 'Ship' }).row!
    updateTask(d, USER, task.id, { workdir: '/w' })
    const spawned = (await invoke(CHANNELS.ptySpawn.name, {
      kind: 'agent',
      pty_id: 'p1',
      tool: 'claude-code',
      task: task.key,
      cols: 80,
      rows: 24
    })) as { ok: boolean; data: { session_id: string } }
    expect(spawned.ok).toBe(true)
    const listed = (await invoke(CHANNELS.sessionList.name, { task_id: task.id })) as {
      ok: boolean
      data: { id: string; tool: string }[]
    }
    expect(listed.ok).toBe(true)
    expect(listed.data.map((s) => s.id)).toEqual([spawned.data.session_id])
    expect(listed.data[0].tool).toBe('claude-code')
    vault.close()
  })

  it('session.adopt por key grava o task_id e devolve a linha', async () => {
    const dir = tmpDir()
    const vault = await readyVault(dir)
    const forDb = domainForOf()
    const { invoke } = harness(vault, forDb)
    const d = forDb(vault.db())
    const task = createTask(d, USER, { title: 'Ship' }).row!
    updateTask(d, USER, task.id, { workdir: '/w' })
    const spawned = (await invoke(CHANNELS.ptySpawn.name, {
      kind: 'agent',
      pty_id: 'scratch',
      tool: 'claude-code',
      task: null,
      cols: 80,
      rows: 24
    })) as { data: { session_id: string } }
    const adopted = (await invoke(CHANNELS.sessionAdopt.name, {
      session_id: spawned.data.session_id,
      task: task.key
    })) as { ok: boolean; data: { row: { id: string } | null } }
    expect(adopted.ok).toBe(true)
    expect(adopted.data.row?.id).toBe(task.id)
    expect(getSession(d, spawned.data.session_id)?.task_id).toBe(task.id)
    vault.close()
  })

  it('pty.write de outro webContents é ignorado', async () => {
    const dir = tmpDir()
    const vault = await readyVault(dir)
    const forDb = domainForOf()
    const { invoke, send, procs } = harness(vault, forDb)
    const d = forDb(vault.db())
    const task = createTask(d, USER, { title: 'Ship' }).row!
    updateTask(d, USER, task.id, { workdir: '/w' })
    await invoke(CHANNELS.ptySpawn.name, {
      kind: 'agent',
      pty_id: 'p1',
      tool: 'claude-code',
      task: task.id,
      cols: 80,
      rows: 24
    })
    send('pty:write', { id: 'p1', data: 'nope' }, 2)
    expect(procs[0].writes).toEqual([])
    send('pty:write', { id: 'p1', data: 'ok' }, 1)
    expect(procs[0].writes).toEqual(['ok'])
    vault.close()
  })

  it('aba reaberta depois do exit aceita write', async () => {
    const dir = tmpDir()
    const vault = await readyVault(dir)
    const forDb = domainForOf()
    const { invoke, send, procs } = harness(vault, forDb)
    const d = forDb(vault.db())
    const task = createTask(d, USER, { title: 'Ship' }).row!
    updateTask(d, USER, task.id, { workdir: '/w' })
    const body = {
      kind: 'agent' as const,
      pty_id: 'p1',
      tool: 'claude-code' as const,
      task: task.id,
      cols: 80,
      rows: 24
    }
    await invoke(CHANNELS.ptySpawn.name, body)
    procs[0].emitExit(0)
    send('pty:write', { id: 'p1', data: 'late' }, 1)
    expect(procs[0].writes).toEqual([])
    await invoke(CHANNELS.ptySpawn.name, body)
    send('pty:write', { id: 'p1', data: 'again' }, 1)
    expect(procs[1].writes).toEqual(['again'])
    vault.close()
  })
})
