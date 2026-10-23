import type { SessionRow, SessionState } from '../../shared/contracts'
import { SESSION_COPY } from '../../shared/copy/session'
import type { Db } from '../db/open'
import { recordActivity } from './activity'
import { nowIso, type Actor, type DomainDeps, type Emit } from './context'
import { DomainError, notFound } from './errors'
import { liveTask, taskRow } from './rows'
import type { TaskCommandResult } from './task'

export const SESSION_TOOLS = ['claude-code', 'codex', 'cursor', 'other'] as const
export type SessionTool = (typeof SESSION_TOOLS)[number]

export type SessionErrorReason = keyof typeof SESSION_COPY.errors

/** Erro de sessão, com `details.reason` e o texto em inglês do `SESSION_COPY`. */
export function sessionError(
  code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT',
  reason: SessionErrorReason,
  details: Record<string, unknown> = {}
): DomainError {
  return new DomainError(code, SESSION_COPY.errors[reason], { reason, ...details })
}

export type OpenedSession = {
  session_id: string
  client_id: string
  task_id: string | null
  tool: SessionTool
  external_id: string | null
  cwd: string | null
  /** Só na retomada: o que `discardOpened` devolve se o spawn falhar. */
  prev: { ended_at: string; state: SessionState; state_at: string } | null
}

type SessionRec = {
  id: string
  task_id: string | null
  tool: SessionTool
  external_id: string | null
  cwd: string | null
  state: SessionState
  state_at: string
  started_at: string
  ended_at: string | null
  label: string | null
}

const SCOPES = '["read","write"]'

const load = (db: Db, id: string): SessionRec | undefined =>
  db.prepare('select * from ai_session where id = ?').get(id) as SessionRec | undefined

const requireSession = (db: Db, id: string): SessionRec => {
  const s = load(db, id)
  if (!s) throw notFound('session', id)
  return s
}

/** Client vivo, senão o de maior id. `null` quando a sessão importada não tem nenhum. */
function clientId(db: Db, sessionId: string): string | null {
  const live = db
    .prepare(
      'select id from mcp_client where ai_session_id = ? and revoked_at is null order by id desc limit 1'
    )
    .get(sessionId) as { id: string } | undefined
  if (live) return live.id
  const any = db
    .prepare('select id from mcp_client where ai_session_id = ? order by id desc limit 1')
    .get(sessionId) as { id: string } | undefined
  return any?.id ?? null
}

function insertClient(
  d: DomainDeps,
  sessionId: string,
  tool: SessionTool,
  key: string | null
): string {
  const id = d.newId()
  d.db
    .prepare(
      `insert into mcp_client(id, kind, name, token_hash, ai_session_id, scopes)
       values (?, 'session', ?, null, ?, ?)`
    )
    .run(id, SESSION_COPY.clientName(tool, key), sessionId, SCOPES)
  return id
}

function taskKey(db: Db, taskId: string | null): string | null {
  if (!taskId) return null
  const r = db.prepare('select key from task where id = ?').get(taskId) as
    { key: string } | undefined
  return r?.key ?? null
}

export function openSession(
  d: DomainDeps,
  i: { task_id: string | null; tool: SessionTool; cwd: string }
): OpenedSession {
  return d.tx((emit) => {
    let key: string | null = null
    if (i.task_id !== null) key = liveTask(d.db, i.task_id).key
    const now = nowIso(d)
    const session_id = d.newId()
    d.db
      .prepare(
        `insert into ai_session(id, task_id, tool, external_id, cwd, state, state_at, started_at)
         values (?, ?, ?, null, ?, 'unknown', ?, ?)`
      )
      .run(session_id, i.task_id, i.tool, i.cwd, now, now)
    const client_id = insertClient(d, session_id, i.tool, key)
    emit({ entity: 'session', ids: [session_id], op: 'upsert' })
    if (i.task_id) emit({ entity: 'task', ids: [i.task_id], op: 'upsert' })
    return {
      session_id,
      client_id,
      task_id: i.task_id,
      tool: i.tool,
      external_id: null,
      cwd: i.cwd,
      prev: null
    }
  })
}

export function reopenSession(
  d: DomainDeps,
  i: { session_id: string; cwd: string }
): OpenedSession {
  return d.tx((emit) => {
    const s = requireSession(d.db, i.session_id)
    if (s.ended_at === null) throw sessionError('CONFLICT', 'session_live')
    const prev = { ended_at: s.ended_at, state: s.state, state_at: s.state_at }
    const now = nowIso(d)
    d.db
      .prepare(
        `update ai_session set ended_at = null, state = 'unknown', state_at = ?, cwd = ? where id = ?`
      )
      .run(now, i.cwd, s.id)
    let client_id = clientId(d.db, s.id)
    if (!client_id) client_id = insertClient(d, s.id, s.tool, taskKey(d.db, s.task_id))
    else d.db.prepare('update mcp_client set revoked_at = null where id = ?').run(client_id)
    emit({ entity: 'session', ids: [s.id], op: 'upsert' })
    if (s.task_id) emit({ entity: 'task', ids: [s.task_id], op: 'upsert' })
    return {
      session_id: s.id,
      client_id,
      task_id: s.task_id,
      tool: s.tool,
      external_id: s.external_id,
      cwd: i.cwd,
      prev
    }
  })
}

/** Spawn que falhou: linha nova some; retomada volta ao estado anterior e revoga o client. */
export function discardOpened(d: DomainDeps, o: OpenedSession): void {
  d.tx((emit) => {
    if (!o.prev) {
      d.db.prepare('delete from mcp_client where ai_session_id = ?').run(o.session_id)
      d.db.prepare('delete from ai_session where id = ?').run(o.session_id)
      emit({ entity: 'session', ids: [o.session_id], op: 'delete' })
      return
    }
    d.db
      .prepare('update ai_session set ended_at = ?, state = ?, state_at = ? where id = ?')
      .run(o.prev.ended_at, o.prev.state, o.prev.state_at, o.session_id)
    d.db.prepare('update mcp_client set revoked_at = ? where id = ?').run(nowIso(d), o.client_id)
    emit({ entity: 'session', ids: [o.session_id], op: 'upsert' })
  })
}

const byStart = (a: SessionRec, b: SessionRec): SessionRec => {
  if (a.started_at !== b.started_at) return a.started_at < b.started_at ? a : b
  return a.id < b.id ? a : b
}

export function recordSessionStart(
  d: DomainDeps,
  sessionId: string,
  i: { external_id: string; cwd: string | null }
): { session_id: string } {
  return d.tx((emit) => {
    const cur = requireSession(d.db, sessionId)
    const other = d.db
      .prepare('select * from ai_session where tool = ? and external_id = ? and id != ?')
      .get(cur.tool, i.external_id, cur.id) as SessionRec | undefined
    if (other && other.ended_at === null) {
      d.db.prepare('update ai_session set cwd = ? where id = ?').run(i.cwd, cur.id)
      emit({ entity: 'session', ids: [cur.id], op: 'upsert' })
      return { session_id: cur.id }
    }
    if (other) {
      const survivor = byStart(cur, other)
      const loser = survivor.id === cur.id ? other : cur
      const task_id = cur.task_id ?? other.task_id
      d.db
        .prepare('update mcp_client set ai_session_id = ? where ai_session_id = ?')
        .run(survivor.id, loser.id)
      d.db.prepare('update ai_session set external_id = null where id = ?').run(loser.id)
      d.db
        .prepare(
          `update ai_session
           set task_id = ?, external_id = ?, cwd = ?, state = ?, state_at = ?, ended_at = null
           where id = ?`
        )
        .run(task_id, i.external_id, i.cwd, cur.state, cur.state_at, survivor.id)
      d.db.prepare('delete from ai_session where id = ?').run(loser.id)
      emit({ entity: 'session', ids: [loser.id], op: 'delete' })
      emit({ entity: 'session', ids: [survivor.id], op: 'upsert' })
      const tasks = [cur.task_id, other.task_id, task_id].filter((id): id is string => id !== null)
      if (tasks.length) emit({ entity: 'task', ids: [...new Set(tasks)], op: 'upsert' })
      return { session_id: survivor.id }
    }
    if (cur.external_id && cur.external_id !== i.external_id) {
      const label = cur.label ? `${cur.label} · ${cur.external_id}` : cur.external_id
      d.db
        .prepare('update ai_session set external_id = ?, cwd = ?, label = ? where id = ?')
        .run(i.external_id, i.cwd, label, cur.id)
    } else {
      d.db
        .prepare('update ai_session set external_id = ?, cwd = ? where id = ?')
        .run(i.external_id, i.cwd, cur.id)
    }
    emit({ entity: 'session', ids: [cur.id], op: 'upsert' })
    return { session_id: cur.id }
  })
}

/** `false` sem escrita quando o estado já é esse ou a sessão está encerrada. */
export function setSessionState(d: DomainDeps, sessionId: string, state: SessionState): boolean {
  return d.tx((emit) => {
    const s = load(d.db, sessionId)
    if (!s || s.ended_at !== null || s.state === state) return false
    const now = nowIso(d)
    d.db.prepare('update ai_session set state = ?, state_at = ? where id = ?').run(state, now, s.id)
    emit({ entity: 'session', ids: [s.id], op: 'upsert' })
    if (s.task_id) emit({ entity: 'task', ids: [s.task_id], op: 'upsert' })
    return true
  })
}

export function endSessionIn(
  d: DomainDeps,
  emit: Emit,
  sessionId: string,
  reason: 'exit' | 'killed' | 'cleanup'
): boolean {
  const s = load(d.db, sessionId)
  if (!s || s.ended_at !== null) return false
  const now = nowIso(d)
  const client = clientId(d.db, s.id)
  d.db.prepare('update ai_session set ended_at = ? where id = ?').run(now, s.id)
  d.db
    .prepare('update mcp_client set revoked_at = ? where ai_session_id = ? and revoked_at is null')
    .run(now, s.id)
  if (s.task_id && client) {
    recordActivity(
      d,
      emit,
      { kind: 'mcp', client_id: client },
      {
        op: 'session_end',
        task_id: s.task_id,
        fields: [],
        inverse: null,
        data: { tool: s.tool, reason }
      }
    )
  }
  emit({ entity: 'session', ids: [s.id], op: 'upsert' })
  if (s.task_id) emit({ entity: 'task', ids: [s.task_id], op: 'upsert' })
  return true
}

export function endSession(
  d: DomainDeps,
  sessionId: string,
  reason: 'exit' | 'killed' | 'cleanup'
): void {
  d.tx((emit) => {
    endSessionIn(d, emit, sessionId, reason)
  })
}

/** Encerra toda sessão viva. No boot, o que sobrou é resto de crash. */
export function endLiveSessions(d: DomainDeps): number {
  return d.tx((emit) => {
    const ids = d.db.prepare('select id from ai_session where ended_at is null').all() as {
      id: string
    }[]
    let n = 0
    for (const { id } of ids) if (endSessionIn(d, emit, id, 'cleanup')) n++
    return n
  })
}

export function adoptSessionIn(
  d: DomainDeps,
  emit: Emit,
  actor: Actor,
  i: { session_id: string; task_id: string }
): string | null {
  const s = requireSession(d.db, i.session_id)
  if (s.task_id !== null) throw sessionError('CONFLICT', 'session_has_task')
  const task = liveTask(d.db, i.task_id)
  d.db.prepare('update ai_session set task_id = ? where id = ?').run(task.id, s.id)
  const activity_id = recordActivity(d, emit, actor, {
    op: 'session_adopt',
    task_id: task.id,
    fields: ['task_id'],
    inverse: null
  })
  emit({ entity: 'session', ids: [s.id], op: 'upsert' })
  emit({ entity: 'task', ids: [task.id], op: 'upsert' })
  return activity_id
}

export function adoptSession(
  d: DomainDeps,
  actor: Actor,
  i: { session_id: string; task_id: string }
): TaskCommandResult {
  const activity_id = d.tx((emit) => adoptSessionIn(d, emit, actor, i))
  const taskId = load(d.db, i.session_id)?.task_id
  return { row: taskId ? taskRow(d, taskId) : null, activity_id }
}

export function listSessions(d: DomainDeps, i: { task_id?: string }): SessionRow[] {
  const where = i.task_id !== undefined ? 'where task_id = ?' : ''
  const args = i.task_id !== undefined ? [i.task_id] : []
  return d.db
    .prepare(
      `select id, tool, external_id, state, state_at, started_at, ended_at, label
       from ai_session ${where} order by started_at desc, id desc`
    )
    .all(...args) as SessionRow[]
}

export function getSession(
  d: DomainDeps,
  id: string
): {
  id: string
  task_id: string | null
  tool: SessionTool
  external_id: string | null
  cwd: string | null
  state: SessionState
  ended_at: string | null
  label: string | null
} | null {
  const s = load(d.db, id)
  if (!s) return null
  return {
    id: s.id,
    task_id: s.task_id,
    tool: s.tool,
    external_id: s.external_id,
    cwd: s.cwd,
    state: s.state,
    ended_at: s.ended_at,
    label: s.label
  }
}

export function liveByExternal(
  d: DomainDeps,
  tool: SessionTool,
  externalId: string
): string | null {
  const r = d.db
    .prepare('select id from ai_session where tool = ? and external_id = ? and ended_at is null')
    .get(tool, externalId) as { id: string } | undefined
  return r?.id ?? null
}
