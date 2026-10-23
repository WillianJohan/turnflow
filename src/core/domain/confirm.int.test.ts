import { describe, expect, it } from 'vitest'
import type { Db } from '../db/open'
import { insertMcpClient, insertTask, openTestDb, seedIds } from '../testing/db'
import { readActivity } from './activity'
import { runCommand } from './commands'
import { DomainError } from './errors'
import { createDomain, type Actor, type DomainDeps } from './context'
import { undoState } from './undo'

const T0 = Date.parse('2026-10-22T12:00:00.000Z')

function setup(): {
  db: Db
  d: DomainDeps
  actors: [string, Actor][]
  stages: string[]
  flow: string
  type: string
} {
  const db = openTestDb()
  const d = createDomain({ db, afterCommit: () => {}, now: () => new Date(T0) })
  const s = seedIds(db)
  const actors: [string, Actor][] = [
    ['user', { kind: 'user' }],
    ['mcp', { kind: 'mcp', client_id: insertMcpClient(db) }],
    ['assistant', { kind: 'assistant' }]
  ]
  return { db, d, actors, stages: s.stages.Feature, flow: s.flows.Feature, type: s.types.Feature }
}

const count = (db: Db, table: string): number =>
  (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n

describe('runCommand: confirmação é uma regra só', () => {
  it('transição não pede confirmação em nenhum caminho', () => {
    const h = setup()
    for (const [name, actor] of h.actors) {
      const id = insertTask(h.db, {
        key: `T-${name}`,
        type_id: h.type,
        flow_id: h.flow,
        stage_id: h.stages[0]
      })
      const out = runCommand(h.d, actor, { op: 'task_set_stage', id, stage_id: h.stages[1] })
      expect(out.status).toBe('done')
      if (out.status !== 'done') throw new Error('esperava done')
      const rows = h.db.prepare('select id from activity where task_id = ?').all(id)
      expect(rows).toHaveLength(1)
      const a = readActivity(h.db, out.result.activity_id!)!
      expect(a.actor).toBe(actor.kind)
      expect(a.client_id).toBe(actor.kind === 'mcp' ? actor.client_id : null)
      expect(undoState(h.d, a).undoable).toBe(true)
    }
  })

  it('apagar pede confirmação nos três', () => {
    const h = setup()
    for (const [name, actor] of h.actors) {
      const id = insertTask(h.db, { key: `T-${name}` })
      const before = count(h.db, 'activity')
      const out = runCommand(h.d, actor, { op: 'task_delete', id })
      expect(out).toEqual({ status: 'needs_confirmation', op: 'task_delete' })
      expect(h.db.prepare('select deleted_at from task where id = ?').get(id)).toEqual({
        deleted_at: null
      })
      expect(count(h.db, 'activity')).toBe(before)

      const done = runCommand(h.d, actor, { op: 'task_delete', id }, { confirmed: true })
      expect(done.status).toBe('done')
      if (done.status !== 'done') throw new Error('esperava done')
      expect(done.result.row).toBeNull()
      const a = readActivity(h.db, done.result.activity_id!)!
      expect(a.inverse?.op).toBe('undelete')
      expect(count(h.db, 'activity')).toBe(before + 1)
    }
  })

  it('apagar projeto pede confirmação nos três', () => {
    const h = setup()
    for (const [name, actor] of h.actors) {
      const created = runCommand(h.d, actor, { op: 'project_create', input: { name: `P-${name}` } })
      if (created.status !== 'done') throw new Error('esperava done')
      const id = created.result.id
      const before = count(h.db, 'activity')
      const out = runCommand(h.d, actor, { op: 'project_delete', id })
      expect(out).toEqual({ status: 'needs_confirmation', op: 'project_delete' })
      expect(h.db.prepare('select id from project where id = ?').get(id)).toBeDefined()
      expect(count(h.db, 'activity')).toBe(before)

      const done = runCommand(h.d, actor, { op: 'project_delete', id }, { confirmed: true })
      expect(done).toMatchObject({ status: 'done', result: { deleted: true } })
      expect(h.db.prepare('select id from project where id = ?').get(id)).toBeUndefined()
      expect(count(h.db, 'activity')).toBe(before + 1)
    }
  })

  it('project_update: id dentro do patch não troca o alvo', () => {
    const h = setup()
    const actor: Actor = { kind: 'user' }
    const mk = (name: string): string => {
      const o = runCommand(h.d, actor, { op: 'project_create', input: { name } })
      if (o.status !== 'done') throw new Error('esperava done')
      return o.result.id
    }
    const a = mk('A')
    const b = mk('B')
    const patch = { name: 'Novo', id: b } as unknown as { name: string }
    runCommand(h.d, actor, { op: 'project_update', id: a, patch })
    const name = (id: string): unknown =>
      (h.db.prepare('select name from project where id = ?').get(id) as { name: string }).name
    expect(name(a)).toBe('Novo')
    expect(name(b)).toBe('B')
  })

  it('op desconhecida: VALIDATION, sem tocar no banco', () => {
    const h = setup()
    const before = count(h.db, 'activity')
    const cmd = { op: 'op_que_nao_existe' } as never
    let err: unknown
    try {
      runCommand(h.d, { kind: 'user' }, cmd, { confirmed: true })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(DomainError)
    expect((err as DomainError).code).toBe('VALIDATION')
    expect(count(h.db, 'activity')).toBe(before)
  })
})
