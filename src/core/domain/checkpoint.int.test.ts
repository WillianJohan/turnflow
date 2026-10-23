import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Db } from '../db/open'
import { runSearch } from '../db/search'
import { insertMcpClient, insertTask, openTestDb } from '../testing/db'
import { readActivity } from './activity'
import { addCheckpoint } from './checkpoint'
import { createDomain, type Actor, type DomainDeps } from './context'
import { DomainError } from './errors'

const T0 = Date.parse('2026-10-22T12:00:00.000Z')
const USER: Actor = { kind: 'user' }

function setup(): { db: Db; d: DomainDeps; nowIso: () => string } {
  const db = openTestDb()
  const d = createDomain({ db, afterCommit: () => {}, now: () => new Date(T0) })
  return { db, d, nowIso: () => new Date(T0).toISOString() }
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

type CpRow = {
  id: string
  task_id: string
  at: string
  text: string
  source: string
  text_hash: string
}
const cps = (db: Db, taskId: string): CpRow[] =>
  db.prepare('select * from checkpoint where task_id = ?').all(taskId) as CpRow[]

describe('addCheckpoint', () => {
  it('grava e limpa a vez', () => {
    const { db, d, nowIso } = setup()
    const id = insertTask(db, { key: 'T-1' })
    db.prepare("update task set turn_reason = 'voltou', turn_at = ? where id = ?").run(
      '2026-10-22T09:00:00.000Z',
      id
    )
    const r = addCheckpoint(d, USER, { task_id: id, text: '  parei no login  ' })
    const [c] = cps(db, id)
    expect(c).toMatchObject({ text: 'parei no login', source: 'user', at: nowIso() })
    expect(c.id).toBe(r.checkpoint_id)
    expect(c.text_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(c.text_hash).toBe(
      createHash('sha256').update('parei no login'.normalize('NFC')).digest('hex')
    )
    const t = db.prepare('select turn_reason, turn_at, touched_at from task where id = ?').get(id)
    expect(t).toEqual({ turn_reason: null, turn_at: null, touched_at: nowIso() })
    expect(r.row).toMatchObject({ group: 'pendente', touched_at: nowIso() })
    const a = readActivity(db, r.activity_id!)!
    expect(a).toMatchObject({ op: 'checkpoint_add', inverse: null, task_id: id })
    expect(a.data.fields).toEqual(['turn_reason', 'turn_at'])
  })

  it('hash vem do texto em NFC e sem espaço nas pontas', () => {
    const { db, d } = setup()
    const id = insertTask(db, { key: 'T-1' })
    addCheckpoint(d, USER, { task_id: id, text: 'café ' })
    expect(cps(db, id)[0].text_hash).toBe(createHash('sha256').update('café').digest('hex'))
  })

  it('source por ator', () => {
    const { db, d } = setup()
    const id = insertTask(db, { key: 'T-1' })
    const actors: [Actor, string][] = [
      [{ kind: 'user' }, 'user'],
      [{ kind: 'mcp', client_id: insertMcpClient(db) }, 'ai'],
      [{ kind: 'assistant' }, 'ai'],
      [{ kind: 'sync' }, 'sync'],
      [{ kind: 'import' }, 'import']
    ]
    for (const [a, src] of actors) {
      const r = addCheckpoint(d, a, { task_id: id, text: `x ${src}` })
      expect(cps(db, id).find((c) => c.id === r.checkpoint_id)!.source).toBe(src)
    }
  })

  it('sem vez a limpar não lista turn_* nos fields', () => {
    const { db, d } = setup()
    const id = insertTask(db, { key: 'T-1' })
    const r = addCheckpoint(d, USER, { task_id: id, text: 'a' })
    expect(readActivity(db, r.activity_id!)!.data.fields).toEqual([])
  })

  it('texto vazio ou longo demais é VALIDATION e não grava', () => {
    const { db, d } = setup()
    const id = insertTask(db, { key: 'T-1' })
    for (const text of ['', '   \n'])
      expect(errOf(() => addCheckpoint(d, USER, { task_id: id, text }))).toEqual({
        code: 'VALIDATION',
        reason: 'text_required'
      })
    expect(errOf(() => addCheckpoint(d, USER, { task_id: id, text: 'a'.repeat(20_001) }))).toEqual({
      code: 'VALIDATION',
      reason: 'too_long'
    })
    expect(cps(db, id)).toEqual([])
    addCheckpoint(d, USER, { task_id: id, text: 'a'.repeat(20_000) })
    expect(cps(db, id)).toHaveLength(1)
  })

  it('task apagada ou inexistente é NOT_FOUND', () => {
    const { db, d } = setup()
    const id = insertTask(db, { key: 'T-1', deleted_at: '2026-10-21T00:00:00.000Z' })
    expect(errOf(() => addCheckpoint(d, USER, { task_id: id, text: 'a' })).code).toBe('NOT_FOUND')
    expect(errOf(() => addCheckpoint(d, USER, { task_id: 'nada', text: 'a' })).code).toBe(
      'NOT_FOUND'
    )
  })

  it('a busca acha o checkpoint', () => {
    const { db, d } = setup()
    const id = insertTask(db, { key: 'T-1' })
    addCheckpoint(d, USER, { task_id: id, text: 'parei no login' })
    const hits = runSearch(db, 'parei no', 30)
    expect(hits.filter((h) => h.kind === 'checkpoint')).toHaveLength(1)
    expect(hits.find((h) => h.kind === 'checkpoint')!.task_id).toBe(id)
  })
})
