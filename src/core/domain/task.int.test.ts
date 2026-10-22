import { describe, expect, it } from 'vitest'
import { TaskDetail, TaskRow } from '../../shared/contracts'
import type { DomainChanged } from '../../shared/ipc/events'
import type { Db } from '../db/open'
import { purgeTask } from '../db/purge'
import { insertTask, openTestDb, seedIds } from '../testing/db'
import { readActivity } from './activity'
import { createDomain, type Actor, type DomainDeps } from './context'
import { DomainError } from './errors'
import { attentionCounts, getTask, listTasks } from './rows'
import { createTask, updateTask } from './task'

const T0 = Date.parse('2026-10-22T12:00:00.000Z')
const MIN = 60_000
const USER: Actor = { kind: 'user' }

type Harness = {
  db: Db
  d: DomainDeps
  events: DomainChanged[]
  /** Avança o relógio injetado. */
  tick: (ms: number) => void
  nowIso: () => string
}

function setup(o: { defaultWorkdir?: () => string | null } = {}): Harness {
  const db = openTestDb()
  const events: DomainChanged[] = []
  let t = T0
  const d = createDomain({
    db,
    afterCommit: (c) => events.push(c),
    now: () => new Date(t),
    defaultWorkdir: o.defaultWorkdir
  })
  return {
    db,
    d,
    events,
    tick: (ms) => (t += ms),
    nowIso: () => new Date(t).toISOString()
  }
}

const reasonOf = (fn: () => unknown): { code: string; reason: unknown } => {
  try {
    fn()
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, reason: e.details?.reason }
    throw e
  }
  throw new Error('não lançou')
}

const countActivity = (db: Db): number =>
  (db.prepare('select count(*) as n from activity').get() as { n: number }).n

const raw = (db: Db, id: string): Record<string, unknown> =>
  db.prepare('select * from task where id = ?').get(id) as Record<string, unknown>

describe('createTask', () => {
  it('sem projeto usa o fluxo do tipo e a key é sequencial', () => {
    const h = setup()
    const ids = seedIds(h.db)
    const r = createTask(h.d, USER, { title: 'a', type_id: ids.types.Bugfix })
    const t = getTask(h.d, r.row!.id)
    expect(raw(h.db, t.id).flow_id).toBe(ids.flows.Bugfix)
    expect(t.type_id).toBe(ids.types.Bugfix)
    expect(t.stage).toMatchObject({ name: 'Reproduzir', position: 1, count: 4, is_final: false })
    expect(t.key).toBe('T-1')
    expect(t.touched_at).toBe(h.nowIso())
    expect(raw(h.db, t.id).created_at).toBe(h.nowIso())
    expect(t.flow_stages.map((s) => s.name)).toEqual([
      'Reproduzir',
      'Corrigir',
      'Review',
      'Entregue'
    ])
    expect(createTask(h.d, USER, { title: 'b', type_id: ids.types.Bugfix }).row!.key).toBe('T-2')
    expect(r.activity_id).not.toBeNull()
    const a = readActivity(h.db, r.activity_id!)!
    expect(a).toMatchObject({ op: 'task_create', actor: 'user', client_id: null, inverse: null })
    expect(a.task_id).toBe(t.id)
  })

  it('sem tipo usa Feature', () => {
    const h = setup()
    const ids = seedIds(h.db)
    const r = createTask(h.d, USER, { title: 'a' })
    expect(r.row!.type_id).toBe(ids.types.Feature)
    expect(raw(h.db, r.row!.id).flow_id).toBe(ids.flows.Feature)
    expect(r.row!.stage.name).toBe('Refinamento')
  })

  it('título é aparado e vazio é VALIDATION title_required', () => {
    const h = setup()
    expect(createTask(h.d, USER, { title: '  a  ' }).row!.title).toBe('a')
    expect(reasonOf(() => createTask(h.d, USER, { title: '   ' }))).toEqual({
      code: 'VALIDATION',
      reason: 'title_required'
    })
  })

  it('tipo ou projeto inexistente é NOT_FOUND', () => {
    const h = setup()
    expect(reasonOf(() => createTask(h.d, USER, { title: 'a', type_id: 'nada' }))).toEqual({
      code: 'NOT_FOUND',
      reason: 'not_found'
    })
    expect(reasonOf(() => createTask(h.d, USER, { title: 'a', project_id: 'nada' }))).toEqual({
      code: 'NOT_FOUND',
      reason: 'not_found'
    })
    expect(countActivity(h.db)).toBe(0)
  })

  it('fluxo congelado: mudar o fluxo do tipo depois não muda a task', () => {
    const h = setup()
    const ids = seedIds(h.db)
    const id = createTask(h.d, USER, { title: 'a', type_id: ids.types.Bugfix }).row!.id
    h.db
      .prepare('update task_type set flow_id = ? where id = ?')
      .run(ids.flows.Pessoal, ids.types.Bugfix)
    const t = getTask(h.d, id)
    expect(raw(h.db, id).flow_id).toBe(ids.flows.Bugfix)
    expect(t.stage.id).toBe(ids.stages.Bugfix[0])
    expect(t.flow_stages).toHaveLength(4)
  })

  it('purge da maior T-n não reaproveita', () => {
    const h = setup()
    const made = ['a', 'b', 'c'].map((title) => createTask(h.d, USER, { title }).row!)
    expect(made.map((r) => r.key)).toEqual(['T-1', 'T-2', 'T-3'])
    purgeTask(h.db, made[2].id, h.d.tx)
    expect(createTask(h.d, USER, { title: 'd' }).row!.key).toBe('T-4')
  })

  it('T-7 existente faz o próximo ser T-8; X-1 e T-7a não interferem', () => {
    const h = setup()
    insertTask(h.db, { key: 'T-7', title: 't' })
    insertTask(h.db, { key: 'X-1', title: 't' })
    insertTask(h.db, { key: 'T-70a', title: 't' })
    expect(createTask(h.d, USER, { title: 'a' }).row!.key).toBe('T-8')
    expect(createTask(h.d, USER, { title: 'b' }).row!.key).toBe('T-9')
  })

  it('falha na activity desfaz a task e não emite', () => {
    const h = setup()
    expect(() =>
      createTask(h.d, { kind: 'mcp', client_id: 'inexistente' }, { title: 'a' })
    ).toThrow()
    expect(h.db.prepare('select count(*) as n from task').get()).toEqual({ n: 0 })
    expect(h.db.prepare('select count(*) as n from key_seq').get()).toEqual({ n: 0 })
    expect(h.events).toHaveLength(0)
  })

  it('domain.changed sai depois do commit, com a linha já visível', () => {
    const db = openTestDb()
    const seen: { c: DomainChanged; visible: boolean }[] = []
    const d = createDomain({
      db,
      afterCommit: (c) => {
        const visible =
          c.entity === 'task'
            ? db.prepare('select 1 from task where id = ?').get(c.ids[0]) !== undefined
            : db.prepare('select 1 from activity where id = ?').get(c.ids[0]) !== undefined
        seen.push({ c, visible: visible && !db.inTransaction })
      }
    })
    const r = createTask(d, USER, { title: 'a' })
    expect(seen).toEqual([
      { c: { entity: 'task', ids: [r.row!.id], op: 'upsert' }, visible: true },
      { c: { entity: 'activity', ids: [r.activity_id], op: 'upsert' }, visible: true }
    ])
  })
})

describe('pasta de trabalho', () => {
  it('vazia vale a padrão; preenchida vale a da task', () => {
    const h = setup({ defaultWorkdir: () => '/padrao' })
    const id = createTask(h.d, USER, { title: 'a' }).row!.id
    expect(getTask(h.d, id)).toMatchObject({ workdir: null, workdir_effective: '/padrao' })

    updateTask(h.d, USER, id, { workdir: '/minha' })
    expect(getTask(h.d, id)).toMatchObject({ workdir: '/minha', workdir_effective: '/minha' })

    expect(reasonOf(() => updateTask(h.d, USER, id, { workdir: 'rel/x' }))).toEqual({
      code: 'VALIDATION',
      reason: 'workdir_relative'
    })
    expect(getTask(h.d, id).workdir).toBe('/minha')

    updateTask(h.d, USER, id, { workdir: '' })
    expect(getTask(h.d, id)).toMatchObject({ workdir: null, workdir_effective: '/padrao' })
  })

  it('as duas vazias dão null', () => {
    const h = setup()
    const id = createTask(h.d, USER, { title: 'a', workdir: '' }).row!.id
    expect(getTask(h.d, id)).toMatchObject({ workdir: null, workdir_effective: null })
  })

  it('createTask também confere a pasta', () => {
    const h = setup()
    expect(reasonOf(() => createTask(h.d, USER, { title: 'a', workdir: '~/x' }))).toEqual({
      code: 'VALIDATION',
      reason: 'workdir_relative'
    })
    expect(createTask(h.d, USER, { title: 'a', workdir: 'C:\\w' }).row).not.toBeNull()
  })
})

describe('updateTask', () => {
  const FIELDS = ['title', 'description', 'sum_what', 'sum_where', 'sum_next', 'workdir'] as const

  it.each(FIELDS)('editar %s toca touched_at e grava 1 task_update', (field) => {
    const h = setup()
    const id = createTask(h.d, USER, { title: 'a' }).row!.id
    const before = countActivity(h.db)
    h.tick(MIN)
    const r = updateTask(h.d, USER, id, { [field]: field === 'workdir' ? '/w' : 'novo' })
    expect(r.row!.touched_at).toBe(h.nowIso())
    expect(raw(h.db, id).touched_at).toBe(h.nowIso())
    expect(countActivity(h.db)).toBe(before + 1)
    const a = readActivity(h.db, r.activity_id!)!
    expect(a).toMatchObject({ op: 'task_update', inverse: null, task_id: id })
    expect(a.data.fields).toEqual([field])
  })

  it('sum_* grava sum_at e sum_source pelo ator', () => {
    const h = setup()
    const id = createTask(h.d, USER, { title: 'a' }).row!.id
    h.tick(MIN)
    updateTask(h.d, USER, id, { sum_where: 'aqui' })
    expect(raw(h.db, id)).toMatchObject({ sum_source: 'user', sum_at: h.nowIso() })

    const client = h.db
      .prepare(
        "insert into mcp_client(id, kind, name, token_hash) values ('c1', 'client', 'c', 'h') returning id"
      )
      .get() as { id: string }
    h.tick(MIN)
    const r = updateTask(h.d, { kind: 'mcp', client_id: client.id }, id, { sum_where: 'ali' })
    expect(raw(h.db, id)).toMatchObject({ sum_source: 'ai', sum_at: h.nowIso() })
    expect(readActivity(h.db, r.activity_id!)).toMatchObject({ actor: 'mcp', client_id: 'c1' })
    expect(getTask(h.d, id)).toMatchObject({ sum_where: 'ali', sum_source: 'ai' })
  })

  it('só os campos que mudaram entram em fields', () => {
    const h = setup()
    const id = createTask(h.d, USER, { title: 'a' }).row!.id
    const r = updateTask(h.d, USER, id, { title: 'a', sum_next: 'depois', description: null })
    expect(readActivity(h.db, r.activity_id!)!.data.fields).toEqual(['sum_next'])
  })

  it('patch igual é no-op: sem activity, sem toque e sem evento', () => {
    const h = setup()
    const id = createTask(h.d, USER, { title: 'a' }).row!.id
    const touched = raw(h.db, id).touched_at
    const n = countActivity(h.db)
    h.events.length = 0
    h.tick(MIN)
    const r = updateTask(h.d, USER, id, { title: 'a' })
    expect(r.activity_id).toBeNull()
    expect(r.row!.id).toBe(id)
    expect(raw(h.db, id).touched_at).toBe(touched)
    expect(countActivity(h.db)).toBe(n)
    expect(h.events).toHaveLength(0)
  })

  it('título vazio é VALIDATION e task inexistente ou apagada é NOT_FOUND', () => {
    const h = setup()
    const id = createTask(h.d, USER, { title: 'a' }).row!.id
    expect(reasonOf(() => updateTask(h.d, USER, id, { title: ' ' })).reason).toBe('title_required')
    expect(reasonOf(() => updateTask(h.d, USER, 'nada', { title: 'b' })).code).toBe('NOT_FOUND')
    h.db.prepare('update task set deleted_at = ? where id = ?').run(h.nowIso(), id)
    expect(reasonOf(() => updateTask(h.d, USER, id, { title: 'b' })).code).toBe('NOT_FOUND')
  })

  it('aceita a key no lugar do id', () => {
    const h = setup()
    createTask(h.d, USER, { title: 'a' })
    expect(updateTask(h.d, USER, 'T-1', { title: 'b' }).row!.title).toBe('b')
  })
})

describe('leitura', () => {
  it('linha antiga sem touched_at usa created_at e passa no zod', () => {
    const h = setup()
    const id = createTask(h.d, USER, { title: 'a' }).row!.id
    h.db.prepare('update task set touched_at = null, description = null where id = ?').run(id)
    const [row] = listTasks(h.d, 'attention')
    expect(row.touched_at).toBe(raw(h.db, id).created_at)
    expect(TaskRow.safeParse(row).success).toBe(true)
    const t = getTask(h.d, id)
    expect(t.touched_at).toBe(raw(h.db, id).created_at)
    expect(t.description).toBe('')
    expect(TaskDetail.safeParse(t).success).toBe(true)
  })

  it('ler não toca: touched_at, turn_reason e activity iguais', () => {
    const h = setup()
    const id = createTask(h.d, USER, { title: 'a' }).row!.id
    h.db
      .prepare("update task set turn_reason = 'voltou', turn_at = ? where id = ?")
      .run(h.nowIso(), id)
    const before = raw(h.db, id)
    const n = countActivity(h.db)
    h.events.length = 0
    for (let i = 0; i < 10; i++) {
      h.tick(MIN)
      getTask(h.d, id)
      listTasks(h.d, 'attention')
      attentionCounts(h.d)
    }
    expect(raw(h.db, id)).toEqual(before)
    expect(countActivity(h.db)).toBe(n)
    expect(h.events).toHaveLength(0)
  })

  it('getTask por key, checkpoints do mais novo ao mais antigo, apagada é NOT_FOUND', () => {
    const h = setup()
    const id = createTask(h.d, USER, { title: 'a' }).row!.id
    const cp = h.db.prepare(
      "insert into checkpoint(id, task_id, at, text, source) values (?, ?, ?, ?, 'user')"
    )
    cp.run('c1', id, '2026-10-20T10:00:00.000Z', 'velho')
    cp.run('c2', id, '2026-10-21T10:00:00.000Z', 'novo')
    const t = getTask(h.d, 'T-1')
    expect(t.id).toBe(id)
    expect(t.checkpoints.map((c) => c.text)).toEqual(['novo', 'velho'])
    expect(t.remote).toBeNull()
    h.db.prepare('update task set deleted_at = ? where id = ?').run(h.nowIso(), id)
    expect(reasonOf(() => getTask(h.d, id)).code).toBe('NOT_FOUND')
    expect(reasonOf(() => getTask(h.d, 'T-1')).code).toBe('NOT_FOUND')
  })

  it('listTasks: apagada some de todos os escopos; done_since só concluídas; ids por id', () => {
    const h = setup()
    const a = createTask(h.d, USER, { title: 'a' }).row!.id
    const b = createTask(h.d, USER, { title: 'b' }).row!.id
    const c = createTask(h.d, USER, { title: 'c' }).row!.id
    h.db.prepare("update task set done_at = '2026-10-20T00:00:00.000Z' where id = ?").run(b)
    h.db.prepare('update task set deleted_at = ? where id = ?').run(h.nowIso(), c)

    expect(listTasks(h.d, 'attention').map((r) => r.id)).toEqual([a])
    expect(listTasks(h.d, {}).map((r) => r.id)).toEqual([b])
    expect(listTasks(h.d, { done_since: '2026-10-19T00:00:00.000Z' }).map((r) => r.id)).toEqual([b])
    expect(listTasks(h.d, { done_since: '2026-10-21T00:00:00.000Z' })).toEqual([])
    expect(
      listTasks(h.d, { ids: [a, b, c, 'nada'] })
        .map((r) => r.id)
        .sort()
    ).toEqual([a, b].sort())
    expect(listTasks(h.d, { ids: [] })).toEqual([])
    expect(attentionCounts(h.d)).toEqual({
      sua_vez: 0,
      pendente: 1,
      encaminhado: 0,
      fila_projeto: 0
    })
  })

  it('listTasks ordena por grupo e sort_key, e escopo de projeto', () => {
    const h = setup()
    const p = h.db
      .prepare("insert into project(id, name) values ('p1', 'P') returning id")
      .get() as { id: string }
    const pend = createTask(h.d, USER, { title: 'pend' }).row!.id
    const vez = createTask(h.d, USER, { title: 'vez', project_id: p.id }).row!.id
    h.db
      .prepare("update task set turn_reason = 'voltou', turn_at = ? where id = ?")
      .run(h.nowIso(), vez)
    const rows = listTasks(h.d, 'attention')
    expect(rows.map((r) => [r.id, r.group])).toEqual([
      [vez, 'sua_vez'],
      [pend, 'pendente']
    ])
    expect(listTasks(h.d, { project_id: p.id }).map((r) => r.id)).toEqual([vez])
    expect(attentionCounts(h.d)).toEqual({
      sua_vez: 1,
      pendente: 1,
      encaminhado: 0,
      fila_projeto: 0
    })
  })

  it('task em projeto ganha item no fim com rankAfter', () => {
    const h = setup()
    h.db.prepare("insert into project(id, name) values ('p1', 'P')").run()
    createTask(h.d, USER, { title: 'a', project_id: 'p1' })
    createTask(h.d, USER, { title: 'b', project_id: 'p1' })
    const items = h.db
      .prepare("select rank, kind from project_item where project_id = 'p1' order by rank")
      .all()
    expect(items).toEqual([
      { rank: 'a0', kind: 'task' },
      { rank: 'a1', kind: 'task' }
    ])
  })

  it('sessão viva aparece no TaskRow', () => {
    const h = setup()
    const id = createTask(h.d, USER, { title: 'a' }).row!.id
    h.db
      .prepare(
        `insert into ai_session(id, task_id, tool, external_id, state, state_at, started_at)
         values ('s1', ?, 'claude', 'x', 'waiting', ?, ?)`
      )
      .run(id, h.nowIso(), h.nowIso())
    const [row] = listTasks(h.d, 'attention')
    expect(row.session).toEqual({ id: 's1', tool: 'claude', state: 'waiting' })
    expect(row.group).toBe('sua_vez')
    expect(getTask(h.d, id).sessions.map((s) => s.id)).toEqual(['s1'])
  })
})
