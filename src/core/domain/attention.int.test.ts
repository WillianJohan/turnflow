import { describe, expect, it } from 'vitest'
import type { TaskRow } from '../../shared/contracts'
import type { DomainChanged } from '../../shared/ipc/events'
import type { Db } from '../db/open'
import { insertMcpClient, insertSession, insertTask, openTestDb, seedIds } from '../testing/db'
import { readActivity, type Inverse } from './activity'
import { blockTask, unblockTask } from './block'
import { addCheckpoint } from './checkpoint'
import { createDomain, type Actor, type DomainDeps } from './context'
import { DomainError } from './errors'
import { attentionCounts, getTask, listTasks } from './rows'
import { createTask, deleteTask, setStage, updateTask } from './task'
import { dismissTask, noteUserPrompt } from './turn'

const T0 = Date.parse('2026-10-22T12:00:00.000Z')
const MIN = 60_000
const DAY = 86_400_000
const USER: Actor = { kind: 'user' }
let MCP: Actor = USER
const SYNC: Actor = { kind: 'sync' }

type Harness = {
  db: Db
  d: DomainDeps
  events: DomainChanged[]
  tick: (ms: number) => void
  nowIso: () => string
  iso: (ms: number) => string
}

function setup(): Harness {
  const db = openTestDb()
  MCP = { kind: 'mcp', client_id: insertMcpClient(db) }
  const events: DomainChanged[] = []
  let t = T0
  const d = createDomain({ db, afterCommit: (c) => events.push(c), now: () => new Date(t) })
  return {
    db,
    d,
    events,
    tick: (ms) => (t += ms),
    nowIso: () => new Date(t).toISOString(),
    iso: (ms) => new Date(ms).toISOString()
  }
}

const errOf = (fn: () => unknown): { code: string; reason: unknown } => {
  try {
    fn()
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, reason: e.details?.reason }
    throw e
  }
  throw new Error('não lançou')
}

type Raw = {
  turn_reason: string | null
  turn_at: string | null
  blocked_reason: string | null
  blocked_at: string | null
  touched_at: string
}
const raw = (db: Db, id: string): Raw =>
  db
    .prepare(
      'select turn_reason, turn_at, blocked_reason, blocked_at, touched_at from task where id = ?'
    )
    .get(id) as Raw

const setTurn = (db: Db, id: string, reason: string | null, at: string | null): void => {
  db.prepare('update task set turn_reason = ?, turn_at = ? where id = ?').run(reason, at, id)
}

const row = (h: Harness, id: string): TaskRow => listTasks(h.d, { ids: [id] })[0]
const countActivity = (db: Db): number =>
  (db.prepare('select count(*) as n from activity').get() as { n: number }).n

/** turn_reason e turn_at saem sempre juntos. */
const turnPaired = (db: Db, id: string): void => {
  const r = raw(db, id)
  expect(r.turn_reason === null).toBe(r.turn_at === null)
}

describe('blockTask', () => {
  it('sem motivo é VALIDATION reason_required e não grava nada', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1' })
    const before = raw(h.db, id)
    for (const reason of ['', '   ']) {
      expect(errOf(() => blockTask(h.d, USER, { id, reason }))).toEqual({
        code: 'VALIDATION',
        reason: 'reason_required'
      })
    }
    expect(raw(h.db, id)).toEqual(before)
    expect(countActivity(h.db)).toBe(0)
  })

  it('com motivo grava, toca e vai para encaminhado/bloqueada', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1', touched_at: h.iso(T0 - 5 * MIN) })
    const r = blockTask(h.d, USER, { id, reason: '  espera o design  ' })
    expect(raw(h.db, id)).toMatchObject({
      blocked_reason: 'espera o design',
      blocked_at: h.nowIso(),
      touched_at: h.nowIso()
    })
    expect(r.row).toMatchObject({ group: 'encaminhado', reason: { kind: 'bloqueada' } })
    const a = readActivity(h.db, r.activity_id!)!
    expect(a.op).toBe('task_block')
    expect(a.data.fields).toEqual(['blocked_reason', 'blocked_at'])
    expect(a.inverse).toEqual({
      op: 'unblock',
      task_id: id,
      expect: { blocked_reason: 'espera o design', blocked_at: h.nowIso() },
      restore: { blocked_reason: null, blocked_at: null }
    } satisfies Inverse)
  })

  it('motivo longo demais é VALIDATION too_long', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1' })
    expect(errOf(() => blockTask(h.d, USER, { id, reason: 'a'.repeat(501) }))).toEqual({
      code: 'VALIDATION',
      reason: 'too_long'
    })
  })

  it('mesmo motivo é no-op; motivo novo guarda o anterior no inverso', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1' })
    blockTask(h.d, USER, { id, reason: 'a' })
    const firstAt = h.nowIso()
    h.tick(10 * MIN)
    const same = blockTask(h.d, USER, { id, reason: ' a ' })
    expect(same.activity_id).toBeNull()
    expect(raw(h.db, id)).toMatchObject({ blocked_at: firstAt, touched_at: firstAt })
    expect(countActivity(h.db)).toBe(1)

    const r = blockTask(h.d, USER, { id, reason: 'b' })
    expect(readActivity(h.db, r.activity_id!)!.inverse).toEqual({
      op: 'unblock',
      task_id: id,
      expect: { blocked_reason: 'b', blocked_at: h.nowIso() },
      restore: { blocked_reason: 'a', blocked_at: firstAt }
    })
  })

  it('task apagada é NOT_FOUND', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1', deleted_at: h.nowIso() })
    expect(errOf(() => blockTask(h.d, USER, { id, reason: 'x' })).code).toBe('NOT_FOUND')
  })
})

describe('unblockTask', () => {
  const blocked = (h: Harness): string => {
    const id = insertTask(h.db, { key: 'T-1' })
    blockTask(h.d, USER, { id, reason: 'espera' })
    h.tick(10 * MIN)
    return id
  }

  it('desbloqueio do usuário não liga desbloqueada', () => {
    const h = setup()
    const id = blocked(h)
    const r = unblockTask(h.d, USER, { id })
    expect(raw(h.db, id)).toMatchObject({
      blocked_reason: null,
      blocked_at: null,
      turn_reason: null,
      turn_at: null
    })
    expect(r.row).toMatchObject({ group: 'pendente', reason: null })
    const a = readActivity(h.db, r.activity_id!)!
    expect(a.op).toBe('task_unblock')
    expect(a.data.fields).toEqual(['blocked_reason', 'blocked_at'])
  })

  it('mcp e sync ligam desbloqueada e caem na Sua vez', () => {
    for (const pick of [() => MCP, () => SYNC, (): Actor => ({ kind: 'assistant' })]) {
      const h = setup()
      const id = blocked(h)
      const r = unblockTask(h.d, pick(), { id })
      expect(raw(h.db, id)).toMatchObject({
        blocked_reason: null,
        turn_reason: 'desbloqueada',
        turn_at: h.nowIso()
      })
      turnPaired(h.db, id)
      expect(r.row).toMatchObject({
        group: 'sua_vez',
        reason: { kind: 'desbloqueada', since: h.nowIso() }
      })
    }
  })

  it('inverso completo: block com blocked_* e turn_* anteriores', () => {
    const h = setup()
    const id = blocked(h)
    const blockedAt = raw(h.db, id).blocked_at
    const r = unblockTask(h.d, MCP, { id })
    expect(readActivity(h.db, r.activity_id!)!.inverse).toEqual({
      op: 'block',
      task_id: id,
      expect: {
        blocked_reason: null,
        blocked_at: null,
        turn_reason: 'desbloqueada',
        turn_at: h.nowIso()
      },
      restore: { blocked_reason: 'espera', blocked_at: blockedAt, turn_reason: null, turn_at: null }
    } satisfies Inverse)
    expect(readActivity(h.db, r.activity_id!)!.data.fields).toEqual([
      'blocked_reason',
      'blocked_at',
      'turn_reason',
      'turn_at'
    ])
  })

  it('desbloqueada não rebaixa voltou e turn_at fica o mais antigo', () => {
    const h = setup()
    const id = blocked(h)
    const nine = h.iso(T0 - 3 * 60 * MIN)
    setTurn(h.db, id, 'voltou', nine)
    h.tick(2 * 60 * MIN)
    const r = unblockTask(h.d, SYNC, { id })
    expect(raw(h.db, id)).toMatchObject({ turn_reason: 'voltou', turn_at: nine })
    // turn_* não mudou: fora do inverso e dos fields
    const a = readActivity(h.db, r.activity_id!)!
    expect(a.inverse).toEqual({
      op: 'block',
      task_id: id,
      expect: { blocked_reason: null, blocked_at: null },
      restore: { blocked_reason: 'espera', blocked_at: expect.any(String) as string }
    })
    expect(a.data.fields).toEqual(['blocked_reason', 'blocked_at'])
  })

  it('não bloqueada é no-op', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1', touched_at: h.iso(T0 - MIN) })
    const r = unblockTask(h.d, MCP, { id })
    expect(r.activity_id).toBeNull()
    expect(raw(h.db, id)).toMatchObject({ turn_reason: null, touched_at: h.iso(T0 - MIN) })
    expect(countActivity(h.db)).toBe(0)
  })
})

describe('Sua vez a partir da sessão', () => {
  it('waiting liga sessao_aguardando; idle desliga; scratch não afeta ninguém', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1', touched_at: h.nowIso() })
    const other = insertTask(h.db, { key: 'T-2', touched_at: h.nowIso() })
    const s = insertSession(h.db, { task_id: id, state: 'waiting', state_at: h.nowIso() })
    insertSession(h.db, { task_id: null, state: 'waiting', state_at: h.nowIso() })
    expect(row(h, id)).toMatchObject({ group: 'sua_vez', reason: { kind: 'sessao_aguardando' } })
    expect(row(h, other).group).toBe('pendente')
    h.db.prepare("update ai_session set state = 'idle' where id = ?").run(s)
    expect(row(h, id).group).toBe('pendente')
  })

  it('dispensar sem motivo é no-op e continua na Sua vez', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1' })
    insertSession(h.db, { task_id: id, state: 'waiting', state_at: h.nowIso() })
    const before = raw(h.db, id)
    const r = dismissTask(h.d, USER, { id })
    expect(r.activity_id).toBeNull()
    expect(r.row!.group).toBe('sua_vez')
    expect(raw(h.db, id)).toEqual(before)
    expect(countActivity(h.db)).toBe(0)
  })
})

describe('dismissTask', () => {
  it('limpa a vez, toca e grava o inverso restore_turn completo', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1' })
    const at = h.iso(T0 - 60 * MIN)
    setTurn(h.db, id, 'voltou', at)
    h.tick(MIN)
    const r = dismissTask(h.d, USER, { id })
    expect(raw(h.db, id)).toMatchObject({
      turn_reason: null,
      turn_at: null,
      touched_at: h.nowIso()
    })
    expect(r.row!.group).toBe('pendente')
    const a = readActivity(h.db, r.activity_id!)!
    expect(a.op).toBe('task_dismiss')
    expect(a.data.fields).toEqual(['turn_reason', 'turn_at'])
    expect(a.inverse).toEqual({
      op: 'restore_turn',
      task_id: id,
      expect: { turn_reason: null, turn_at: null },
      restore: { turn_reason: 'voltou', turn_at: at, notification_ids: [] }
    } satisfies Inverse)
  })

  it('task apagada é NOT_FOUND', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1', deleted_at: h.nowIso() })
    expect(errOf(() => dismissTask(h.d, USER, { id })).code).toBe('NOT_FOUND')
  })
})

describe('ler não tira da Sua vez', () => {
  it('getTask e listTasks mantêm sua_vez', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1' })
    setTurn(h.db, id, 'voltou', h.nowIso())
    getTask(h.d, id)
    listTasks(h.d, 'attention')
    expect(row(h, id).group).toBe('sua_vez')
    expect(raw(h.db, id).turn_reason).toBe('voltou')
  })
})

describe('sai da Sua vez', () => {
  it('avançar etapa, checkpoint, noteUserPrompt e dismissTask tiram as quatro', () => {
    const h = setup()
    const ids = seedIds(h.db)
    const mk = (title: string): string => {
      const id = createTask(h.d, USER, { title }).row!.id
      setTurn(h.db, id, 'voltou', h.nowIso())
      return id
    }
    const [a, b, c, e] = [mk('a'), mk('b'), mk('c'), mk('d')]
    for (const id of [a, b, c, e]) expect(row(h, id).group).toBe('sua_vez')
    h.tick(2 * MIN)
    setStage(h.d, USER, { id: a, stage_id: ids.stages.Feature[1] })
    addCheckpoint(h.d, USER, { task_id: b, text: 'segui' })
    expect(noteUserPrompt(h.d, c)).toBe(true)
    dismissTask(h.d, USER, { id: e })
    for (const id of [a, b, c, e]) {
      expect(row(h, id).group).not.toBe('sua_vez')
      turnPaired(h.db, id)
      expect(raw(h.db, id).turn_reason).toBeNull()
    }
  })
})

describe('noteUserPrompt', () => {
  it('sem vez, duas chamadas em 30 s escrevem uma vez', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1', touched_at: h.iso(T0 - 2 * MIN) })
    expect(noteUserPrompt(h.d, id)).toBe(true)
    const first = raw(h.db, id).touched_at
    expect(first).toBe(h.nowIso())
    h.tick(30_000)
    h.events.length = 0
    expect(noteUserPrompt(h.d, id)).toBe(false)
    expect(raw(h.db, id).touched_at).toBe(first)
    expect(h.events).toEqual([])
    h.tick(30_000)
    expect(noteUserPrompt(h.d, id)).toBe(true)
    expect(raw(h.db, id).touched_at).toBe(h.nowIso())
  })

  it('com vez ligada sempre escreve e emite task/upsert, sem Atividade', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1', touched_at: h.nowIso() })
    setTurn(h.db, id, 'atribuida', h.nowIso())
    h.events.length = 0
    expect(noteUserPrompt(h.d, id)).toBe(true)
    expect(raw(h.db, id)).toMatchObject({ turn_reason: null, turn_at: null })
    expect(h.events).toContainEqual({ entity: 'task', ids: [id], op: 'upsert' })
    setTurn(h.db, id, 'atribuida', h.nowIso())
    expect(noteUserPrompt(h.d, id)).toBe(true)
    expect(countActivity(h.db)).toBe(0)
  })

  it('touched_at nulo vale created_at', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1', touched_at: h.nowIso() })
    h.db
      .prepare('update task set touched_at = null, created_at = ? where id = ?')
      .run(h.nowIso(), id)
    expect(noteUserPrompt(h.d, id)).toBe(false)
  })

  it('task apagada ou inexistente devolve false', () => {
    const h = setup()
    const id = insertTask(h.db, { key: 'T-1', deleted_at: h.nowIso(), touched_at: h.iso(T0 - DAY) })
    expect(noteUserPrompt(h.d, id)).toBe(false)
    expect(noteUserPrompt(h.d, 'nada')).toBe(false)
    expect(raw(h.db, id).touched_at).toBe(h.iso(T0 - DAY))
  })
})

describe('3 dias parada', () => {
  it('vira pendente apagada; com projeto vira fila_projeto', () => {
    const h = setup()
    const old = h.iso(T0 - 3 * DAY - MIN)
    const id = insertTask(h.db, { key: 'T-1', touched_at: old })
    expect(row(h, id)).toMatchObject({ group: 'pendente', faded: true })
    h.db.prepare("insert into project(id, name) values ('p1', 'P')").run()
    h.db
      .prepare(
        "insert into project_item(id, project_id, rank, kind, task_id) values ('i1','p1','m','task',?)"
      )
      .run(id)
    h.db.prepare("update task set project_id = 'p1' where id = ?").run(id)
    expect(row(h, id)).toMatchObject({ group: 'fila_projeto', faded: false })
  })
})

describe('touched_at só com a lista', () => {
  const setupTask = (h: Harness): string => {
    const id = createTask(h.d, USER, { title: 't' }).row!.id
    h.tick(10 * MIN)
    return id
  }
  const ids = (h: Harness): ReturnType<typeof seedIds> => seedIds(h.db)

  const MUDA: [string, (h: Harness, id: string) => unknown][] = [
    ['editar', (h, id) => updateTask(h.d, USER, id, { title: 'novo' })],
    ['etapa', (h, id) => setStage(h.d, USER, { id, stage_id: ids(h).stages.Feature[1] })],
    ['bloquear', (h, id) => blockTask(h.d, USER, { id, reason: 'x' })],
    [
      'desbloquear',
      (h, id) => {
        blockTask(h.d, USER, { id, reason: 'x' })
        h.tick(MIN)
        return unblockTask(h.d, USER, { id })
      }
    ],
    ['checkpoint', (h, id) => addCheckpoint(h.d, USER, { task_id: id, text: 'x' })],
    [
      'dispensar',
      (h, id) => {
        setTurn(h.db, id, 'voltou', h.nowIso())
        return dismissTask(h.d, USER, { id })
      }
    ]
  ]
  it.each(MUDA)('%s muda', (_n, op) => {
    const h = setup()
    const id = setupTask(h)
    const before = raw(h.db, id).touched_at
    op(h, id)
    expect(raw(h.db, id).touched_at).toBe(h.nowIso())
    expect(raw(h.db, id).touched_at).not.toBe(before)
  })

  it('criar toca', () => {
    const h = setup()
    const id = createTask(h.d, USER, { title: 't' }).row!.id
    expect(raw(h.db, id).touched_at).toBe(h.nowIso())
  })

  const NAO_MUDA: [string, (h: Harness, id: string) => unknown][] = [
    ['getTask', (h, id) => getTask(h.d, id)],
    ['listTasks', (h) => listTasks(h.d, 'attention')],
    ['attentionCounts', (h) => attentionCounts(h.d)],
    ['deleteTask', (h, id) => deleteTask(h.d, USER, { id })]
  ]
  it.each(NAO_MUDA)('%s não muda', (_n, op) => {
    const h = setup()
    const id = setupTask(h)
    const before = raw(h.db, id).touched_at
    op(h, id)
    expect(raw(h.db, id).touched_at).toBe(before)
  })
})
