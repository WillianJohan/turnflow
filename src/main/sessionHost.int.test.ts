import { describe, expect, it, vi } from 'vitest'
import type { Db } from '../core/db/open'
import { createDomain, type Actor, type DomainDeps } from '../core/domain/context'
import { importUpdateTaskIn } from '../core/domain/importTask'
import { attentionCounts, taskRow } from '../core/domain/rows'
import { getSession } from '../core/domain/session'
import { createTask, updateTask } from '../core/domain/task'
import { runCommand } from '../core/domain/commands'
import { insertSession, openTestDb } from '../core/testing/db'
import { CONFIG_COPY } from '../shared/copy/config'
import { SESSION_COPY } from '../shared/copy/session'
import { VAULT_COPY } from '../shared/copy/vault'
import { startHookServer } from './hooks'
import { shellArgv } from './launch'
import { createSessionHost, type SessionHost, type SessionHostDeps } from './sessionHost'
import type { PtyProc, PtySpawner } from './pty'

const T0 = Date.parse('2026-10-22T12:00:00.000Z')
const USER: Actor = { kind: 'user' }
const U = '00000000-0000-4000-8000-000000000001'
const U2 = '00000000-0000-4000-8000-000000000002'

type Fake = PtyProc & { emitData(d: string): void; emitExit(code?: number): void; kills: number }
type Call = { file: string; args: string[]; o: Parameters<PtySpawner>[2] }

function fakeSpawner(): {
  spawner: PtySpawner
  procs: Fake[]
  calls: Call[]
  boom: { on: boolean; error?: Error }
} {
  const procs: Fake[] = []
  const calls: Call[] = []
  const boom: { on: boolean; error?: Error } = { on: false }
  const spawner: PtySpawner = (file, args, o) => {
    if (boom.on) throw boom.error ?? new Error('spawn failed')
    calls.push({ file, args, o })
    let data: (d: string) => void = () => undefined
    let exit: (e: { exitCode: number }) => void = () => undefined
    const p: Fake = {
      pid: 1000 + procs.length,
      onData: (cb) => void (data = cb),
      onExit: (cb) => void (exit = cb),
      write: () => undefined,
      resize: () => undefined,
      kill: () => void p.kills++,
      emitData: (d) => data(d),
      emitExit: (code = 0) => exit({ exitCode: code }),
      kills: 0
    }
    procs.push(p)
    return p
  }
  return { spawner, procs, calls, boom }
}

type Box = {
  db: Db
  d: DomainDeps | null
  tick: (ms: number) => void
  host: SessionHost
  procs: Fake[]
  calls: Call[]
  boom: { on: boolean; error?: Error }
  events: SessionHostDeps['events']
  logs: string[]
  port: number
  close: () => Promise<void>
  dirExists: (p: string) => boolean
  transcript: { cwd: string } | null
  elsewhere: number | null
  elsewhereTool: string | null
  workdir: string | null
  other: string[] | null
  /** `null` = claude não instalado. */
  claude: string | null
  /** Segura o `bins()` até resolver: simula o start lento (login do shell). */
  gate: Promise<void> | null
}

async function boot(over: { workdir?: string | null } = {}): Promise<Box> {
  const db = openTestDb()
  let t = T0
  const d0 = createDomain({ db, afterCommit: () => undefined, now: () => new Date(t) })
  const box = {
    db,
    d: d0 as DomainDeps | null,
    tick: (ms: number) => {
      t += ms
    }
  } as Box
  box.logs = []
  box.dirExists = () => true
  box.transcript = { cwd: '/w' }
  box.elsewhere = null
  box.elsewhereTool = null
  box.workdir = over.workdir === undefined ? '/d' : over.workdir
  box.other = null
  box.claude = 'claude'
  box.gate = null
  const fake = fakeSpawner()
  box.procs = fake.procs
  box.calls = fake.calls
  box.boom = fake.boom
  box.events = { data: () => undefined, exit: () => undefined, state: () => undefined }
  const states: Parameters<SessionHostDeps['events']['state']>[] = []
  const exits: [string, number][] = []
  box.events = {
    data: () => undefined,
    exit: (id, code) => void exits.push([id, code]),
    state: (id, s, info) => void states.push([id, s, info])
  }
  ;(box as Box & { states: typeof states; exits: typeof exits }).states = states
  ;(box as Box & { exits: typeof exits }).exits = exits
  const portBox = { n: 0 }
  let n = 0
  const host = createSessionHost({
    spawner: fake.spawner,
    domain: () => box.d,
    bins: async () => {
      if (box.gate) await box.gate
      return {
        claude: box.claude,
        codex: ['codex'],
        cursor: ['cursor-agent'],
        other: box.other
      }
    },
    path: async () => '/usr/bin',
    settingsPath: '/settings.json',
    socketPath: '/tmp/turnflow.sock',
    hookPort: () => portBox.n,
    defaultWorkdir: () => box.workdir,
    home: '/srv/me',
    platform: 'linux',
    dirExists: async (p) => box.dirExists(p),
    findTranscript: async () => box.transcript,
    runningElsewhere: async (_u, _own, tool) => {
      box.elsewhereTool = tool
      return box.elsewhere
    },
    events: box.events,
    log: (line) => box.logs.push(line),
    newToken: () => `tok-${++n}`
  })
  box.host = host
  const server = await startHookServer({
    accept: (token) => host.accept(token),
    onHook: (token, body) => host.onHook(token, body)
  })
  portBox.n = server.port
  box.port = server.port
  box.close = () => server.close()
  return box
}

const statesOf = (b: Box): Parameters<SessionHostDeps['events']['state']>[] =>
  (b as Box & { states: Parameters<SessionHostDeps['events']['state']>[] }).states

const task = (b: Box, workdir?: string): { id: string; key: string } => {
  const row = createTask(b.d!, USER, { title: 'Ship' }).row!
  if (workdir) updateTask(b.d!, USER, row.id, { workdir })
  return { id: row.id, key: row.key }
}

const spawn = (
  b: Box,
  over: Partial<Parameters<SessionHost['spawn']>[0]> = {}
): ReturnType<SessionHost['spawn']> =>
  b.host.spawn({
    pty_id: 'p1',
    cols: 80,
    rows: 24,
    kind: 'agent',
    tool: 'claude-code',
    task: null,
    ...over
  })

const post = async (b: Box, token: string, body: unknown): Promise<number> => {
  const res = await fetch(`http://127.0.0.1:${b.port}/hook`, {
    method: 'POST',
    headers: { 'x-turnflow-token': token, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return res.status
}

const changes = (db: Db): number =>
  (db.prepare('select total_changes() as n').get() as { n: number }).n

const sessions = (db: Db): number =>
  (db.prepare('select count(*) as n from ai_session').get() as { n: number }).n

function tokenInDb(db: Db, token: string): boolean {
  const q = (s: string): string => `"${s.replaceAll('"', '""')}"`
  const tables = db
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
    .all() as { name: string }[]
  for (const { name } of tables) {
    const cols = db.prepare(`pragma table_info(${q(name)})`).all() as { name: string }[]
    for (const col of cols) {
      const n = db
        .prepare(`select count(*) as n from ${q(name)} where cast(${q(col.name)} as text) like ?`)
        .get(`%${token}%`) as { n: number }
      if (n.n > 0) return true
    }
  }
  return false
}

describe('session host', () => {
  it('spawn cria sessão, token só no env', async () => {
    const b = await boot()
    const t = task(b, '/w')
    const opened = await spawn(b, { task: t.key })
    const env = b.calls[0].o.env
    expect(sessions(b.db)).toBe(1)
    expect(
      b.db.prepare('select kind from mcp_client where ai_session_id = ?').get(opened.session_id)
    ).toEqual({ kind: 'session' })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.TURNFLOW_TASK).toBe('T-1')
    expect(env.TURNFLOW_SESSION_TOKEN).toBe('tok-1')
    expect(env.TURNFLOW_HOOK_PORT).toBe(String(b.port))
    expect(env.TURNFLOW_SOCKET).toBe('/tmp/turnflow.sock')
    expect(b.calls[0].args.join(' ')).not.toContain('tok-1')
    expect(b.calls[0].file).toBe('claude')
    await post(b, 'tok-1', { hook_event_name: 'SessionStart', session_id: U, cwd: '/w' })
    expect(tokenInDb(b.db, 'tok-1')).toBe(false)
    await b.close()
    b.db.close()
  })

  it('mapa de estado com o PTY fake', async () => {
    const b = await boot()
    const t = task(b, '/w')
    await spawn(b, { task: t.id })
    expect(
      await post(b, 'tok-1', { hook_event_name: 'SessionStart', session_id: U, cwd: '/w' })
    ).toBe(204)
    const again = await spawn(b, { task: t.id, pty_id: 'p1' })
    expect(getSession(b.d!, again.session_id!)?.external_id).toBe(U)
    const sid = b.host.alive()
    expect(sid).toEqual(['p1'])
    const row = (): NonNullable<ReturnType<typeof taskRow>> => taskRow(b.d!, t.id)!
    expect(row().session?.state).toBe('idle')
    await post(b, 'tok-1', { hook_event_name: 'UserPromptSubmit' })
    expect(row().session?.state).toBe('working')
    await post(b, 'tok-1', {
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'allow?'
    })
    expect(row().group).toBe('sua_vez')
    expect(statesOf(b).at(-1)).toEqual([
      'p1',
      'waiting',
      { event: 'Notification', message: 'allow?' }
    ])
    await post(b, 'tok-1', { hook_event_name: 'UserPromptSubmit' })
    expect(row().group).not.toBe('sua_vez')
    await post(b, 'tok-1', { hook_event_name: 'Stop' })
    expect(row().session?.state).toBe('idle')
    expect(row().group).toBe('pendente')
    await post(b, 'tok-1', { hook_event_name: 'Notification', notification_type: 'idle_prompt' })
    expect(row().group).not.toBe('sua_vez')
    b.logs.length = 0
    const before = row().session?.state
    await post(b, 'tok-1', { hook_event_name: 'Notification' })
    expect(row().session?.state).toBe(before)
    expect(b.logs).toEqual(['hook Notification ignored: type <none>'])
    b.logs.length = 0
    await post(b, 'tok-1', { hook_event_name: 'Notification', notification_type: 'auth_success' })
    expect(b.logs).toEqual(['hook Notification ignored: type auth_success'])
    await b.close()
    b.db.close()
  })

  it('PreToolUse repetido escreve uma vez', async () => {
    const b = await boot()
    const t = task(b, '/w')
    await spawn(b, { task: t.id })
    await post(b, 'tok-1', { hook_event_name: 'SessionStart', session_id: U })
    const n = changes(b.db)
    for (let i = 0; i < 50; i++) await post(b, 'tok-1', { hook_event_name: 'PreToolUse' })
    expect(changes(b.db) - n).toBe(1)
    await b.close()
    b.db.close()
  })

  it('UserPromptSubmit limpa turn_reason e toca touched_at com throttle', async () => {
    const b = await boot()
    const t = task(b, '/w')
    b.db
      .prepare("update task set turn_reason = 'voltou', turn_at = ? where id = ?")
      .run(new Date(T0).toISOString(), t.id)
    await spawn(b, { task: t.id })
    await post(b, 'tok-1', { hook_event_name: 'UserPromptSubmit' })
    expect(
      (
        b.db.prepare('select turn_reason from task where id = ?').get(t.id) as {
          turn_reason: string | null
        }
      ).turn_reason
    ).toBeNull()
    const touched = b.db.prepare('select touched_at from task where id = ?').get(t.id) as {
      touched_at: string
    }
    b.tick(30_000)
    await post(b, 'tok-1', { hook_event_name: 'UserPromptSubmit' })
    const again = b.db.prepare('select touched_at from task where id = ?').get(t.id) as {
      touched_at: string
    }
    expect(again.touched_at).toBe(touched.touched_at)
    await b.close()
    b.db.close()
  })

  it('token de PTY encerrado é recusado', async () => {
    const b = await boot()
    const t = task(b, '/w')
    const opened = await spawn(b, { task: t.id })
    b.procs[0].emitExit(0)
    expect(await post(b, 'tok-1', { hook_event_name: 'Stop' })).toBe(401)
    const row = b.db
      .prepare('select ended_at from ai_session where id = ?')
      .get(opened.session_id) as {
      ended_at: string | null
    }
    expect(row.ended_at).not.toBeNull()
    const client = b.db
      .prepare('select revoked_at from mcp_client where ai_session_id = ?')
      .get(opened.session_id) as { revoked_at: string | null }
    expect(client.revoked_at).not.toBeNull()
    const act = b.db.prepare("select op from activity where op = 'session_end'").get()
    expect(act).toEqual({ op: 'session_end' })
    await b.close()
    b.db.close()
  })

  it('token de outra sessão não mexe nesta', async () => {
    const b = await boot()
    const t = task(b, '/w')
    const a = await spawn(b, { pty_id: 'a', task: t.id })
    const c = await spawn(b, { pty_id: 'c', task: null })
    await post(b, 'tok-2', { hook_event_name: 'UserPromptSubmit' })
    expect(getSession(b.d!, a.session_id!)?.state).toBe('unknown')
    expect(getSession(b.d!, c.session_id!)?.state).toBe('working')
    await b.close()
    b.db.close()
  })

  it('aba reaberta antes do exit velho → CONFLICT pty_busy sem tocar na sessão velha', async () => {
    const b = await boot()
    const t = task(b, '/w')
    const first = await spawn(b, { task: t.id })
    b.host.kill('p1')
    await expect(spawn(b, { task: t.id })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'pty_busy' }
    })
    // nada novo no banco, a sessão velha segue aberta e o token dela vale até o processo sair
    expect(sessions(b.db)).toBe(1)
    expect(b.calls).toHaveLength(1)
    expect(getSession(b.d!, first.session_id!)?.ended_at).toBeNull()
    expect(await post(b, 'tok-1', { hook_event_name: 'Stop' })).toBe(204)
    b.procs[0].emitExit(0)
    expect(getSession(b.d!, first.session_id!)?.ended_at).not.toBeNull()
    expect(await post(b, 'tok-1', { hook_event_name: 'Stop' })).toBe(401)
    const second = await spawn(b, { task: t.id })
    expect(second.session_id).not.toBe(first.session_id)
    expect(getSession(b.d!, second.session_id!)?.ended_at).toBeNull()
    expect(b.host.alive()).toEqual(['p1'])
    await b.close()
    b.db.close()
  })

  it('processo velho sai durante o start do novo → só a sessão velha encerra', async () => {
    const b = await boot()
    const t = task(b, '/w')
    const first = await spawn(b, { task: t.id })
    b.host.kill('p1')
    let release = (): void => undefined
    b.gate = new Promise((r) => (release = r))
    const pending = spawn(b, { task: t.id })
    await new Promise((r) => setTimeout(r, 5))
    b.procs[0].emitExit(0)
    release()
    const second = await pending
    expect(second.session_id).not.toBe(first.session_id)
    expect(getSession(b.d!, first.session_id!)?.ended_at).not.toBeNull()
    expect(getSession(b.d!, second.session_id!)?.ended_at).toBeNull()
    expect(b.host.alive()).toEqual(['p1'])
    expect(await post(b, 'tok-1', { hook_event_name: 'UserPromptSubmit' })).toBe(401)
    expect(await post(b, 'tok-2', { hook_event_name: 'UserPromptSubmit' })).toBe(204)
    expect(getSession(b.d!, second.session_id!)?.state).toBe('working')
    await b.close()
    b.db.close()
  })

  it('exit repetido de um processo velho não encerra a sessão nova do mesmo pty_id', async () => {
    const b = await boot()
    const t = task(b, '/w')
    await spawn(b, { task: t.id })
    b.host.kill('p1')
    b.procs[0].emitExit(0)
    const second = await spawn(b, { task: t.id })
    b.procs[0].emitExit(0)
    expect(getSession(b.d!, second.session_id!)?.ended_at).toBeNull()
    expect(await post(b, 'tok-2', { hook_event_name: 'Stop' })).toBe(204)
    expect(b.logs.some((l) => l.includes('stale'))).toBe(true)
    await b.close()
    b.db.close()
  })

  it('outro start do mesmo pty_id durante o await não apaga a entrada que subiu', async () => {
    const b = await boot()
    const t = task(b, '/w')
    let release = (): void => undefined
    b.gate = new Promise((r) => (release = r))
    const one = spawn(b, { task: t.id })
    const two = spawn(b, { task: t.id })
    release()
    const [a, c] = await Promise.all([one, two])
    // clique duplo: a segunda chamada devolve a sessão da primeira, sem segunda linha
    expect(c.session_id).toBe(a.session_id)
    expect(sessions(b.db)).toBe(1)
    expect(b.calls).toHaveLength(1)
    expect(await post(b, 'tok-1', { hook_event_name: 'UserPromptSubmit' })).toBe(204)
    expect(getSession(b.d!, a.session_id!)?.state).toBe('working')
    await b.close()
    b.db.close()
  })

  it('retomar abre claude --resume na mesma pasta', async () => {
    const b = await boot({ workdir: '/w' })
    const t = task(b)
    const opened = await spawn(b, { task: t.id })
    await post(b, 'tok-1', { hook_event_name: 'SessionStart', session_id: U, cwd: '/w' })
    b.host.kill('p1')
    b.procs[0].emitExit(0)
    b.calls.length = 0
    const again = await spawn(b, { pty_id: 'p2', task: t.id, resume: opened.session_id! })
    expect(again.session_id).toBe(opened.session_id)
    expect(b.calls[0].args.slice(0, 2)).toEqual(['--resume', U])
    expect(b.calls[0].o.cwd).toBe('/w')
    b.transcript = null
    b.host.kill('p2')
    b.procs[1].emitExit(0)
    await expect(
      spawn(b, { pty_id: 'p3', task: t.id, resume: opened.session_id! })
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: { reason: 'transcript_missing' }
    })
    await b.close()
    b.db.close()
  })

  it('retomar recusa processo de fora, aba vizinha e pasta sumida', async () => {
    const b = await boot({ workdir: '/w' })
    const t = task(b)
    const opened = await spawn(b, { task: t.id })
    await post(b, 'tok-1', { hook_event_name: 'SessionStart', session_id: U, cwd: '/w' })
    await expect(
      spawn(b, { pty_id: 'p2', task: t.id, resume: opened.session_id! })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'open_in_app', pty_id: 'p1' }
    })
    b.host.kill('p1')
    b.procs[0].emitExit(0)
    b.elsewhere = 4242
    await expect(
      spawn(b, { pty_id: 'p2', task: t.id, resume: opened.session_id! })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'running_elsewhere', pid: 4242 }
    })
    expect(b.elsewhereTool).toBe('claude-code')
    b.elsewhere = null
    b.dirExists = (p) => p !== '/w'
    await expect(
      spawn(b, { pty_id: 'p2', task: t.id, resume: opened.session_id! })
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: { reason: 'cwd_gone', path: '/w' }
    })
    await b.close()
    b.db.close()
  })

  it('cwd vazio cai na pasta da task', async () => {
    const b = await boot()
    const t = task(b, '/task')
    const opened = await spawn(b, { task: t.id })
    await post(b, 'tok-1', { hook_event_name: 'SessionStart', session_id: U })
    b.host.kill('p1')
    b.procs[0].emitExit(0)
    b.transcript = { cwd: '' }
    b.calls.length = 0
    await spawn(b, { pty_id: 'p2', task: t.id, resume: opened.session_id! })
    expect(b.calls[0].o.cwd).toBe('/task')
    await b.close()
    b.db.close()
  })

  it('sem pasta pergunta', async () => {
    const b = await boot({ workdir: null })
    const t = task(b)
    const before = sessions(b.db)
    await expect(spawn(b, { task: t.id })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'workdir_required' }
    })
    expect(sessions(b.db)).toBe(before)
    updateTask(b.d!, USER, t.id, { workdir: '/chosen' })
    const opened = await spawn(b, { task: t.id })
    expect(opened.session_id).not.toBeNull()
    expect(b.calls.at(-1)?.o.cwd).toBe('/chosen')
    await b.close()
    b.db.close()
  })

  it('spawner que lança não deixa linha', async () => {
    const b = await boot()
    const t = task(b, '/w')
    b.boom.on = true
    await expect(spawn(b, { task: t.id })).rejects.toThrow('spawn failed')
    expect(sessions(b.db)).toBe(0)
    expect(await post(b, 'tok-1', { hook_event_name: 'Stop' })).toBe(401)
    await b.close()
    b.db.close()
  })

  it('binário do agente que não existe → NOT_FOUND agent_missing com a copy, sem linha', async () => {
    const b = await boot()
    const t = task(b, '/w')
    b.boom.on = true
    for (const error of [
      Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }),
      new Error('File not found: C:\\npm\\codex.exe')
    ]) {
      b.boom.error = error
      await expect(spawn(b, { tool: 'codex', task: t.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: SESSION_COPY.errors.agent_missing,
        details: { reason: 'agent_missing', command: 'codex' }
      })
    }
    expect(sessions(b.db)).toBe(0)
    await b.close()
    b.db.close()
  })

  it('scratch', async () => {
    const b = await boot()
    const t = task(b, '/w')
    const opened = await spawn(b, { task: null })
    expect(b.calls[0].o.env.TURNFLOW_TASK).toBeUndefined()
    await post(b, 'tok-1', {
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt'
    })
    expect(attentionCounts(b.d!).sua_vez).toBe(0)
    runCommand(b.d!, USER, { op: 'session_adopt', session_id: opened.session_id!, task_id: t.id })
    await post(b, 'tok-1', {
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt'
    })
    expect(taskRow(b.d!, t.id)?.group).toBe('sua_vez')
    await b.close()
    b.db.close()
  })

  it('import adota órfã viva', async () => {
    const b = await boot()
    const t = task(b, '/w')
    await spawn(b, { task: null, pty_id: 'avulsa' })
    await post(b, 'tok-1', { hook_event_name: 'SessionStart', session_id: U, cwd: '/d' })
    b.d!.tx((emit) =>
      importUpdateTaskIn(b.d!, emit, {
        task_id: t.id,
        sessions: [{ external_id: U, at: '2026-01-03T12:00:00.000Z', label: 'scope' }]
      })
    )
    await post(b, 'tok-1', {
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt'
    })
    expect(taskRow(b.d!, t.id)?.group).toBe('sua_vez')
    expect(b.host.alive()).toEqual(['avulsa'])
    await b.close()
    b.db.close()
  })

  it('SessionEnd + SessionStart novo mantém a sessão viva', async () => {
    const b = await boot()
    const t = task(b, '/w')
    const opened = await spawn(b, { task: t.id })
    await post(b, 'tok-1', { hook_event_name: 'SessionStart', session_id: U })
    await post(b, 'tok-1', { hook_event_name: 'SessionEnd' })
    await post(b, 'tok-1', { hook_event_name: 'SessionStart', session_id: U2 })
    const row = getSession(b.d!, opened.session_id!)!
    expect(row.ended_at).toBeNull()
    expect(row.external_id).toBe(U2)
    expect(row.label).toBe(U)
    await b.close()
    b.db.close()
  })

  it('Esc sozinho em working grava idle; Esc em idle não escreve', async () => {
    const b = await boot()
    const t = task(b, '/w')
    await spawn(b, { task: t.id })
    await post(b, 'tok-1', { hook_event_name: 'UserPromptSubmit' })
    b.host.write('p1', '\x1b')
    const sid = (b.db.prepare('select id from ai_session').get() as { id: string }).id
    expect(getSession(b.d!, sid)?.state).toBe('idle')
    const n = changes(b.db)
    b.host.write('p1', '\x1b')
    expect(changes(b.db)).toBe(n)
    await post(b, 'tok-1', { hook_event_name: 'UserPromptSubmit' })
    const n2 = changes(b.db)
    b.host.write('p1', '\x1b[A')
    expect(getSession(b.d!, sid)?.state).toBe('working')
    expect(changes(b.db)).toBe(n2)
    await b.close()
    b.db.close()
  })

  it('banco fora de ready', async () => {
    const b = await boot()
    const t = task(b, '/w')
    await spawn(b, { task: t.id })
    b.d = null
    expect(await post(b, 'tok-1', { hook_event_name: 'Stop' })).toBe(204)
    expect(statesOf(b).at(-1)?.[1]).toBe('idle')
    await expect(spawn(b, { pty_id: 'p2', task: t.id })).rejects.toMatchObject({
      code: 'LOCKED',
      message: VAULT_COPY.errors.LOCKED
    })
    await b.close()
    b.db.close()
  })

  it('banco ready limpa sessão presa de crash', async () => {
    const b = await boot()
    const t = task(b, '/w')
    const id = insertSession(b.db, {
      task_id: t.id,
      state: 'waiting',
      state_at: new Date(T0).toISOString()
    })
    b.host.onVaultReady(b.d!)
    expect(getSession(b.d!, id)?.ended_at).not.toBeNull()
    expect(taskRow(b.d!, t.id)?.group).not.toBe('sua_vez')
    await b.close()
    b.db.close()
  })

  it('onVaultLeft mata os agentes', async () => {
    const b = await boot()
    const t = task(b, '/w')
    await spawn(b, { pty_id: 'a', task: t.id })
    await spawn(b, { pty_id: 'b', task: null })
    b.host.onVaultLeft()
    expect(b.procs[0].kills).toBe(1)
    expect(b.procs[1].kills).toBe(1)
    await b.close()
    b.db.close()
  })

  it('Codex: working com saída nos últimos 3 s, senão unknown, e nunca Sua vez', async () => {
    const b = await boot()
    const t = task(b, '/w')
    const opened = await spawn(b, { tool: 'codex', task: t.id })
    const sid = opened.session_id!
    expect(taskRow(b.d!, t.id)?.group).not.toBe('sua_vez')
    vi.useFakeTimers()
    try {
      b.procs[0].emitData('out')
      expect(b.host.stateOf('p1')).toBe('working')
      expect(getSession(b.d!, sid)?.state).toBe('working')
      expect(statesOf(b).at(-1)).toEqual(['p1', 'working', { event: 'output' }])
      expect(taskRow(b.d!, t.id)?.group).not.toBe('sua_vez')
      await vi.advanceTimersByTimeAsync(3001)
      expect(b.host.stateOf('p1')).toBe('unknown')
      expect(getSession(b.d!, sid)?.state).toBe('unknown')
      expect(statesOf(b).at(-1)).toEqual(['p1', 'unknown', { event: 'quiet' }])
      expect(taskRow(b.d!, t.id)?.group).not.toBe('sua_vez')
    } finally {
      vi.useRealTimers()
    }
    await b.close()
    b.db.close()
  })

  it('Codex ignora hook: Notification não leva a task a Sua vez', async () => {
    const b = await boot()
    const t = task(b, '/w')
    const opened = await spawn(b, { tool: 'codex', task: t.id })
    for (const body of [
      { hook_event_name: 'Notification', notification_type: 'permission_prompt' },
      { hook_event_name: 'SessionStart', session_id: U, cwd: '/w' },
      { hook_event_name: 'Stop' }
    ])
      expect(await post(b, 'tok-1', body)).toBe(204)
    expect(b.host.stateOf('p1')).toBeNull()
    expect(getSession(b.d!, opened.session_id!)).toMatchObject({
      state: 'unknown',
      external_id: null
    })
    expect(taskRow(b.d!, t.id)?.group).not.toBe('sua_vez')
    await b.close()
    b.db.close()
  })

  it('sem claude instalado: terminal e Codex abrem, claude-code dá NOT_FOUND sem linha', async () => {
    const b = await boot()
    b.claude = null
    const t = task(b, '/w')
    await expect(spawn(b, { pty_id: 'c', task: t.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: CONFIG_COPY.claudeNotFound
    })
    expect(sessions(b.db)).toBe(0)
    expect(b.calls).toHaveLength(0)
    await spawn(b, { pty_id: 'x', tool: 'codex', task: t.id })
    await b.host.spawn({ pty_id: 's', kind: 'shell', cols: 80, rows: 24 })
    expect(b.host.alive().sort()).toEqual(['s', 'x'])
    await b.close()
    b.db.close()
  })

  it('retomar Codex só com o external_id do E7; sem ele é not_resumable', async () => {
    const b = await boot()
    const t = task(b, '/w')
    const opened = await spawn(b, { tool: 'codex', task: t.id })
    b.host.kill('p1')
    b.procs[0].emitExit(0)
    await expect(
      spawn(b, { pty_id: 'p2', tool: 'codex', task: t.id, resume: opened.session_id! })
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { reason: 'not_resumable' } })
    const e7 = insertSession(b.db, {
      task_id: t.id,
      state: 'idle',
      state_at: '2026-10-22T11:00:00.000Z',
      ended_at: '2026-10-22T11:30:00.000Z',
      external_id: U2,
      cwd: '/w',
      tool: 'codex'
    })
    b.calls.length = 0
    await spawn(b, { pty_id: 'p3', tool: 'codex', task: t.id, resume: e7 })
    expect([b.calls[0].file, ...b.calls[0].args]).toEqual(['codex', 'resume', U2])
    expect(b.elsewhereTool).toBe('codex')
    await b.close()
    b.db.close()
  })

  it('Cursor e Outra ficam unknown', async () => {
    const b = await boot()
    b.other = ['my-ai']
    const t = task(b, '/w')
    const cur = await spawn(b, { pty_id: 'c', tool: 'cursor', task: t.id })
    expect(b.host.stateOf('c')).toBe('unknown')
    expect(getSession(b.d!, cur.session_id!)?.state).toBe('unknown')
    expect(
      await post(b, 'tok-1', {
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        message: 'allow?'
      })
    ).toBe(204)
    expect(b.host.stateOf('c')).toBe('unknown')
    expect(getSession(b.d!, cur.session_id!)?.state).toBe('unknown')
    expect(taskRow(b.d!, t.id)?.group).not.toBe('sua_vez')
    const oth = await spawn(b, { pty_id: 'o', tool: 'other', task: t.id })
    expect(b.host.stateOf('o')).toBe('unknown')
    expect(await post(b, 'tok-2', { hook_event_name: 'Stop' })).toBe(204)
    expect(b.host.stateOf('o')).toBe('unknown')
    expect(getSession(b.d!, oth.session_id!)?.state).toBe('unknown')
    expect(taskRow(b.d!, t.id)?.group).not.toBe('sua_vez')
    await b.close()
    b.db.close()
  })

  it('Outra sem comando → VALIDATION agent_not_configured', async () => {
    const b = await boot()
    const t = task(b, '/w')
    await expect(spawn(b, { tool: 'other', task: t.id })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'agent_not_configured' }
    })
    expect(sessions(b.db)).toBe(0)
    await b.close()
    b.db.close()
  })

  it('terminal puro abre o shell sem IA', async () => {
    const b = await boot()
    const opened = await b.host.spawn({ pty_id: 'sh', cols: 80, rows: 24, kind: 'shell' })
    expect(opened).toEqual({ session_id: null })
    expect(sessions(b.db)).toBe(0)
    expect([b.calls[0].file, ...b.calls[0].args]).toEqual(shellArgv('linux', process.env))
    expect(b.calls[0].o.env?.PATH).toBe('/usr/bin')
    expect(b.calls[0].o.env?.TURNFLOW_SESSION_TOKEN).toBeUndefined()
    expect(b.calls[0].o.env?.TURNFLOW_HOOK_PORT).toBeUndefined()
    expect(b.calls[0].o.env?.TURNFLOW_TASK).toBeUndefined()
    await b.close()
    b.db.close()
  })

  it('onVaultLeft não mata o shell', async () => {
    const b = await boot()
    const t = task(b, '/w')
    await spawn(b, { pty_id: 'a', task: t.id })
    await b.host.spawn({ pty_id: 'sh', cols: 80, rows: 24, kind: 'shell' })
    b.host.onVaultLeft()
    expect(b.procs[0].kills).toBe(1)
    expect(b.procs[1].kills).toBe(0)
    expect(b.host.alive()).toEqual(['sh'])
    await b.close()
    b.db.close()
  })
})
