import { describe, expect, it } from 'vitest'
import type { DomainChanged } from '../../shared/ipc/events'
import { SESSION_COPY } from '../../shared/copy/session'
import type { Db } from '../db/open'
import { insertSession, openTestDb } from '../testing/db'
import { createDomain, type Actor, type DomainDeps } from './context'
import { DomainError } from './errors'
import { attentionCounts, taskRow } from './rows'
import {
  adoptSession,
  discardOpened,
  endLiveSessions,
  endSession,
  getSession,
  listSessions,
  liveByExternal,
  openSession,
  recordSessionStart,
  reopenSession,
  setSessionState
} from './session'
import { createTask, deleteTask } from './task'
import { runCommand } from './commands'
import { listActivity } from './undo'

const T0 = Date.parse('2026-10-22T12:00:00.000Z')
const USER: Actor = { kind: 'user' }
const U = '00000000-0000-4000-8000-000000000001'

type Harness = {
  db: Db
  d: DomainDeps
  events: DomainChanged[]
  tick: (ms: number) => void
}

function setup(newId?: () => string): Harness {
  const db = openTestDb()
  const events: DomainChanged[] = []
  let t = T0
  const d = createDomain({
    db,
    afterCommit: (c) => events.push(c),
    now: () => new Date(t),
    newId
  })
  return { db, d, events, tick: (ms) => (t += ms) }
}

const changes = (db: Db): number =>
  (db.prepare('select total_changes() as n').get() as { n: number }).n

const reasonOf = (fn: () => unknown): { code: string; reason: unknown } => {
  try {
    fn()
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, reason: e.details?.reason }
    throw e
  }
  throw new Error('não lançou')
}

const task = (h: Harness, title = 'a'): { id: string; key: string } => {
  const row = createTask(h.d, USER, { title }).row!
  return { id: row.id, key: row.key }
}

const sessionRow = (db: Db, id: string): Record<string, unknown> =>
  db.prepare('select * from ai_session where id = ?').get(id) as Record<string, unknown>

const clients = (db: Db, sessionId: string): { id: string; revoked_at: string | null }[] =>
  db
    .prepare('select id, revoked_at from mcp_client where ai_session_id = ? order by id')
    .all(sessionId) as { id: string; revoked_at: string | null }[]

describe('sessão', () => {
  it('openSession cria ai_session e mcp_client na mesma transação', () => {
    const h = setup()
    const t = task(h)
    const o = openSession(h.d, { task_id: t.id, tool: 'claude-code', cwd: '/w' })
    const s = sessionRow(h.db, o.session_id)
    expect(s).toMatchObject({
      task_id: t.id,
      tool: 'claude-code',
      state: 'unknown',
      cwd: '/w',
      external_id: null,
      ended_at: null
    })
    expect(s.state_at).toBe(s.started_at)
    const c = h.db.prepare('select * from mcp_client where id = ?').get(o.client_id) as {
      kind: string
      ai_session_id: string
      token_hash: string | null
      scopes: string
      name: string
    }
    expect(c).toMatchObject({
      kind: 'session',
      ai_session_id: o.session_id,
      token_hash: null,
      scopes: '["read","write"]',
      name: SESSION_COPY.clientName('claude-code', t.key)
    })

    const boom = setup()
    const t2 = task(boom)
    let n = 0
    boom.d.newId = () => {
      n++
      if (n === 2) throw new Error('id')
      return 'only-session'
    }
    expect(() => openSession(boom.d, { task_id: t2.id, tool: 'claude-code', cwd: '/w' })).toThrow(
      'id'
    )
    expect(boom.db.prepare('select count(*) as n from ai_session').get()).toEqual({ n: 0 })
  })

  it('reopen reaproveita a linha e zera revoked_at', () => {
    const h = setup()
    const t = task(h)
    const opened = openSession(h.d, { task_id: t.id, tool: 'claude-code', cwd: '/w' })
    endSession(h.d, opened.session_id, 'exit')
    const again = reopenSession(h.d, { session_id: opened.session_id, cwd: '/w2' })
    expect(again.session_id).toBe(opened.session_id)
    expect(again.client_id).toBe(opened.client_id)
    expect(again.prev).toMatchObject({ state: 'unknown', ended_at: new Date(T0).toISOString() })
    expect(sessionRow(h.db, opened.session_id)).toMatchObject({
      ended_at: null,
      state: 'unknown',
      cwd: '/w2'
    })
    expect(clients(h.db, opened.session_id)[0]?.revoked_at).toBeNull()
    expect(
      reasonOf(() => reopenSession(h.d, { session_id: opened.session_id, cwd: '/w' }))
    ).toEqual({ code: 'CONFLICT', reason: 'session_live' })

    const imported = insertSession(h.db, {
      task_id: t.id,
      state: 'idle',
      state_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-02T00:00:00.000Z',
      external_id: U
    })
    const back = reopenSession(h.d, { session_id: imported, cwd: '/imp' })
    expect(back.session_id).toBe(imported)
    expect(clients(h.db, imported)).toHaveLength(1)
    expect(sessionRow(h.db, imported).ended_at).toBeNull()
  })

  it('discardOpened', () => {
    const h = setup()
    const t = task(h)
    const fresh = openSession(h.d, { task_id: t.id, tool: 'claude-code', cwd: '/w' })
    discardOpened(h.d, fresh)
    expect(sessionRow(h.db, fresh.session_id)).toBeUndefined()
    expect(h.db.prepare('select count(*) as n from mcp_client').get()).toEqual({ n: 0 })

    const opened = openSession(h.d, { task_id: t.id, tool: 'claude-code', cwd: '/w' })
    endSession(h.d, opened.session_id, 'exit')
    const prevState = sessionRow(h.db, opened.session_id)
    const again = reopenSession(h.d, { session_id: opened.session_id, cwd: '/n' })
    discardOpened(h.d, again)
    expect(sessionRow(h.db, opened.session_id)).toMatchObject({
      ended_at: prevState.ended_at,
      state: prevState.state,
      state_at: prevState.state_at
    })
    expect(clients(h.db, opened.session_id)[0]?.revoked_at).not.toBeNull()
  })

  it('SessionStart grava external_id e cwd', () => {
    const h = setup()
    const t = task(h)
    const o = openSession(h.d, { task_id: t.id, tool: 'claude-code', cwd: '/old' })
    const r = recordSessionStart(h.d, o.session_id, { external_id: U, cwd: '/new' })
    expect(r.session_id).toBe(o.session_id)
    expect(sessionRow(h.db, o.session_id)).toMatchObject({ external_id: U, cwd: '/new' })
    expect(liveByExternal(h.d, 'claude-code', U)).toBe(o.session_id)
  })

  it('bifurcação guarda o antigo no label', () => {
    const h = setup()
    const t = task(h)
    const id = insertSession(h.db, {
      task_id: t.id,
      state: 'idle',
      state_at: '2026-01-01T00:00:00.000Z',
      external_id: 'X',
      tool: 'claude-code'
    })
    recordSessionStart(h.d, id, { external_id: 'Y', cwd: '/w' })
    expect(sessionRow(h.db, id)).toMatchObject({ external_id: 'Y', label: 'X' })

    const labeled = insertSession(h.db, {
      task_id: t.id,
      state: 'idle',
      state_at: '2026-01-01T00:00:00.000Z',
      external_id: 'P',
      label: 'scope',
      tool: 'claude-code'
    })
    recordSessionStart(h.d, labeled, { external_id: 'Q', cwd: '/w' })
    expect(sessionRow(h.db, labeled).label).toBe('scope · P')
  })

  it('fusão na mais antiga repõe a mcp_client', () => {
    const h = setup()
    const t1 = task(h, 'one')
    const t2 = task(h, 'two')
    const a = insertSession(h.db, {
      task_id: t1.id,
      state: 'idle',
      state_at: '2026-01-01T00:00:00.000Z',
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-02-01T00:00:00.000Z',
      external_id: U,
      cwd: '/old',
      tool: 'claude-code'
    })
    const b = insertSession(h.db, {
      task_id: t1.id,
      state: 'working',
      state_at: '2026-06-01T00:00:00.000Z',
      started_at: '2026-06-01T00:00:00.000Z',
      external_id: null,
      cwd: '/live',
      tool: 'claude-code'
    })
    h.db
      .prepare(
        `insert into mcp_client(id, kind, name, ai_session_id, scopes) values ('c-b', 'session', 'n', ?, '["read","write"]')`
      )
      .run(b)
    expect(recordSessionStart(h.d, b, { external_id: U, cwd: '/live' }).session_id).toBe(a)
    expect(sessionRow(h.db, a)).toMatchObject({
      ended_at: null,
      state: 'working',
      state_at: '2026-06-01T00:00:00.000Z',
      cwd: '/live',
      task_id: t1.id,
      external_id: U
    })
    expect(sessionRow(h.db, b)).toBeUndefined()
    expect(clients(h.db, a).map((c) => c.id)).toEqual(['c-b'])

    const a2 = insertSession(h.db, {
      task_id: t1.id,
      state: 'idle',
      state_at: '2026-01-01T00:00:00.000Z',
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-02-01T00:00:00.000Z',
      external_id: 'U2',
      tool: 'claude-code'
    })
    const scratch = insertSession(h.db, {
      task_id: null,
      state: 'working',
      state_at: '2026-07-01T00:00:00.000Z',
      started_at: '2026-07-01T00:00:00.000Z',
      external_id: null,
      cwd: '/s',
      tool: 'claude-code'
    })
    expect(recordSessionStart(h.d, scratch, { external_id: 'U2', cwd: '/s' }).session_id).toBe(a2)
    expect(sessionRow(h.db, a2).task_id).toBe(t1.id)

    const liveA = insertSession(h.db, {
      task_id: t2.id,
      state: 'idle',
      state_at: '2026-01-01T00:00:00.000Z',
      started_at: '2026-01-01T00:00:00.000Z',
      external_id: 'U3',
      tool: 'claude-code'
    })
    const liveB = insertSession(h.db, {
      task_id: t2.id,
      state: 'working',
      state_at: '2026-08-01T00:00:00.000Z',
      started_at: '2026-08-01T00:00:00.000Z',
      external_id: null,
      tool: 'claude-code'
    })
    expect(recordSessionStart(h.d, liveB, { external_id: 'U3', cwd: '/x' }).session_id).toBe(liveB)
    expect(sessionRow(h.db, liveB).external_id).toBeNull()
    expect(sessionRow(h.db, liveA).external_id).toBe('U3')
  })

  it('estado só escreve quando muda', () => {
    const h = setup()
    const t = task(h)
    const o = openSession(h.d, { task_id: t.id, tool: 'claude-code', cwd: '/w' })
    const before = changes(h.db)
    for (let i = 0; i < 100; i++)
      expect(setSessionState(h.d, o.session_id, 'working')).toBe(i === 0)
    expect(changes(h.db) - before).toBe(1)
    endSession(h.d, o.session_id, 'exit')
    expect(setSessionState(h.d, o.session_id, 'idle')).toBe(false)
  })

  it('endSession encerra, revoga e registra', () => {
    const h = setup()
    const t = task(h)
    const o = openSession(h.d, { task_id: t.id, tool: 'claude-code', cwd: '/w' })
    endSession(h.d, o.session_id, 'exit')
    expect(sessionRow(h.db, o.session_id).ended_at).toBe(new Date(T0).toISOString())
    expect(clients(h.db, o.session_id)[0]?.revoked_at).toBe(new Date(T0).toISOString())
    const act = listActivity(h.d, { task_id: t.id }).find((a) => a.op === 'session_end')
    expect(act?.summary).toBe(SESSION_COPY.activity.end)
    const raw = h.db
      .prepare("select client_id, data from activity where op = 'session_end'")
      .get() as {
      client_id: string
      data: string
    }
    expect(raw.client_id).toBe(o.client_id)
    expect(JSON.parse(raw.data)).toMatchObject({ tool: 'claude-code', reason: 'exit' })
    const n = h.db.prepare("select count(*) as n from activity where op = 'session_end'").get()
    endSession(h.d, o.session_id, 'exit')
    expect(
      h.db.prepare("select count(*) as n from activity where op = 'session_end'").get()
    ).toEqual(n)

    const scratch = openSession(h.d, { task_id: null, tool: 'codex', cwd: '/s' })
    endSession(h.d, scratch.session_id, 'killed')
    expect(h.db.prepare('select count(*) as n from activity where task_id is null').get()).toEqual({
      n: 0
    })
    expect(sessionRow(h.db, scratch.session_id).ended_at).not.toBeNull()
  })

  it('endLiveSessions encerra e revoga', () => {
    const h = setup()
    const t = task(h)
    const waiting = openSession(h.d, { task_id: t.id, tool: 'claude-code', cwd: '/w' })
    setSessionState(h.d, waiting.session_id, 'waiting')
    expect(taskRow(h.d, t.id)?.group).toBe('sua_vez')
    openSession(h.d, { task_id: null, tool: 'claude-code', cwd: '/s' })
    expect(endLiveSessions(h.d)).toBe(2)
    expect(taskRow(h.d, t.id)?.session).toBeNull()
    expect(taskRow(h.d, t.id)?.group).not.toBe('sua_vez')
    expect(clients(h.db, waiting.session_id)[0]?.revoked_at).not.toBeNull()
  })

  it('scratch nunca entra no group()', () => {
    const h = setup()
    const o = openSession(h.d, { task_id: null, tool: 'claude-code', cwd: '/s' })
    setSessionState(h.d, o.session_id, 'waiting')
    expect(attentionCounts(h.d).sua_vez).toBe(0)
  })

  it('adotar', () => {
    const h = setup()
    const t = task(h)
    const touched = taskRow(h.d, t.id)!.touched_at
    const scratch = openSession(h.d, { task_id: null, tool: 'claude-code', cwd: '/s' })
    setSessionState(h.d, scratch.session_id, 'waiting')
    const done = runCommand(h.d, USER, {
      op: 'session_adopt',
      session_id: scratch.session_id,
      task_id: t.id
    })
    expect(done.status).toBe('done')
    if (done.status !== 'done') return
    expect(done.result.row?.group).toBe('sua_vez')
    expect(sessionRow(h.db, scratch.session_id).task_id).toBe(t.id)
    expect(taskRow(h.d, t.id)?.touched_at).toBe(touched)
    const act = listActivity(h.d, { task_id: t.id }).find((a) => a.op === 'session_adopt')
    expect(act?.summary).toBe(SESSION_COPY.activity.adopt)

    const owned = openSession(h.d, { task_id: t.id, tool: 'claude-code', cwd: '/w' })
    const other = task(h, 'other')
    expect(
      reasonOf(() => adoptSession(h.d, USER, { session_id: owned.session_id, task_id: other.id }))
    ).toEqual({ code: 'CONFLICT', reason: 'session_has_task' })

    const free = openSession(h.d, { task_id: null, tool: 'cursor', cwd: '/c' })
    deleteTask(h.d, USER, { id: other.id })
    expect(
      reasonOf(() => adoptSession(h.d, USER, { session_id: free.session_id, task_id: other.id }))
    ).toEqual({ code: 'NOT_FOUND', reason: 'not_found' })
  })

  it('listSessions', () => {
    const h = setup()
    const t = task(h)
    const first = openSession(h.d, { task_id: t.id, tool: 'claude-code', cwd: '/a' })
    h.tick(1000)
    const second = openSession(h.d, { task_id: t.id, tool: 'codex', cwd: '/b' })
    h.tick(1000)
    const scratch = openSession(h.d, { task_id: null, tool: 'cursor', cwd: '/c' })
    expect(listSessions(h.d, {}).map((s) => s.id)).toEqual([
      scratch.session_id,
      second.session_id,
      first.session_id
    ])
    expect(listSessions(h.d, { task_id: t.id }).map((s) => s.id)).toEqual([
      second.session_id,
      first.session_id
    ])
    expect(getSession(h.d, first.session_id)).toMatchObject({
      id: first.session_id,
      task_id: t.id,
      tool: 'claude-code',
      cwd: '/a',
      state: 'unknown',
      ended_at: null
    })
    expect(getSession(h.d, 'missing')).toBeNull()
    expect(liveByExternal(h.d, 'claude-code', 'nope')).toBeNull()
  })
})
