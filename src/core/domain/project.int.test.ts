import { describe, expect, it } from 'vitest'
import type { DomainChanged } from '../../shared/ipc/events'
import type { Db } from '../db/open'
import { dumpTables, openTestDb, seedIds } from '../testing/db'
import { readActivity } from './activity'
import { createDomain, type Actor, type DomainDeps } from './context'
import { DomainError } from './errors'
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  moveTask,
  updateProject
} from './project'
import { listTasks, type TaskRecord } from './rows'
import { createTask, deleteTask, setStage } from './task'

const T0 = Date.parse('2026-10-22T12:00:00.000Z')
const MIN = 60_000
const USER: Actor = { kind: 'user' }

type Harness = {
  db: Db
  d: DomainDeps
  events: DomainChanged[]
  ids: ReturnType<typeof seedIds>
  tick: (ms: number) => void
}

function setup(): Harness {
  const db = openTestDb()
  const events: DomainChanged[] = []
  let t = T0
  const d = createDomain({ db, afterCommit: (c) => events.push(c), now: () => new Date(t) })
  return { db, d, events, ids: seedIds(db), tick: (ms) => (t += ms) }
}

const errOf = (fn: () => unknown): DomainError => {
  try {
    fn()
  } catch (e) {
    if (e instanceof DomainError) return e
    throw e
  }
  throw new Error('não lançou')
}

const raw = (db: Db, id: string): TaskRecord =>
  db.prepare('select * from task where id = ?').get(id) as TaskRecord

const items = (db: Db, projectId: string): { task_id: string; rank: string }[] =>
  db
    .prepare('select task_id, rank from project_item where project_id = ? order by rank')
    .all(projectId) as { task_id: string; rank: string }[]

const feature = (h: Harness): string =>
  createTask(h.d, USER, { title: 't', type_id: h.ids.types.Feature }).row!.id

describe('moveTask: pergunta antes de escrever', () => {
  it('avulsa em projeto de outro fluxo pergunta', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'P', flow_id: h.ids.flows.Bugfix })
    const id = feature(h)
    const e = errOf(() => moveTask(h.d, USER, { id, project_id: p.id }))
    expect([e.code, e.details?.reason]).toEqual(['CONFLICT', 'choose_keep_adopt'])
    expect(e.details?.choice).toEqual(['keep', 'adopt'])
  })

  it('CONFLICT de move não escreve nem emite', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'P', flow_id: h.ids.flows.Bugfix })
    const id = feature(h)
    h.events.length = 0
    const tables = ['task', 'project_item', 'activity']
    const before = dumpTables(h.db, tables)
    errOf(() => moveTask(h.d, USER, { id, project_id: p.id }))
    errOf(() => moveTask(h.d, USER, { id, project_id: p.id, choice: 'adopt' }))
    expect(dumpTables(h.db, tables)).toEqual(before)
    expect(h.events).toHaveLength(0)
  })

  it('adopt devolve a prévia e aplica com mapping, guardando o inverso completo', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'P', flow_id: h.ids.flows.Bugfix })
    const id = feature(h)
    const cur = raw(h.db, id)
    const e = errOf(() => moveTask(h.d, USER, { id, project_id: p.id, choice: 'adopt' }))
    expect([e.code, e.details?.reason]).toEqual(['CONFLICT', 'remap_required'])
    expect(e.details?.preview).toHaveLength(4)
    expect(e.details?.missing).toEqual([cur.stage_id])

    h.tick(MIN)
    const to = h.ids.stages.Bugfix[1]
    const r = moveTask(h.d, USER, {
      id,
      project_id: p.id,
      choice: 'adopt',
      mapping: { [cur.stage_id]: to }
    })
    const now = raw(h.db, id)
    expect([now.project_id, now.flow_id, now.stage_id]).toEqual([p.id, h.ids.flows.Bugfix, to])
    expect(now.touched_at).toBe(new Date(T0 + MIN).toISOString())
    expect(r.row?.id).toBe(id)
    expect(items(h.db, p.id)).toEqual([{ task_id: id, rank: 'a0' }])

    const a = readActivity(h.db, r.activity_id!)!
    expect(a.op).toBe('task_move')
    expect(a.inverse).toEqual({
      op: 'move_project',
      task_id: id,
      expect: { project_id: p.id, flow_id: h.ids.flows.Bugfix, stage_id: to },
      restore: {
        project_id: null,
        flow_id: cur.flow_id,
        stage_id: cur.stage_id,
        item: null
      }
    })
    expect(a.data.fields).toEqual(['project_id', 'flow_id', 'stage_id'])
  })

  it('adopt para etapa final grava done_at no inverso', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'P', flow_id: h.ids.flows.Bugfix })
    const id = feature(h)
    const cur = raw(h.db, id)
    const fin = h.ids.stages.Bugfix[3]
    const r = moveTask(h.d, USER, {
      id,
      project_id: p.id,
      choice: 'adopt',
      mapping: { [cur.stage_id]: fin }
    })
    const now = raw(h.db, id)
    expect(now.done_at).toBe(new Date(T0).toISOString())
    const inv = readActivity(h.db, r.activity_id!)!.inverse!
    expect(inv.expect.done_at).toBe(now.done_at)
    expect(inv.restore.done_at).toBeNull()
  })

  it('adopt com par fora do fluxo do projeto falha sem escrever, mesmo com a sugestão certa', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'P', flow_id: h.ids.flows.Bugfix })
    const id = feature(h)
    const cur = raw(h.db, id)
    const before = dumpTables(h.db, ['task', 'project_item', 'activity'])
    h.events.length = 0
    const e = errOf(() =>
      moveTask(h.d, USER, {
        id,
        project_id: p.id,
        choice: 'adopt',
        mapping: { [cur.stage_id]: h.ids.stages.Personal[0] }
      })
    )
    expect([e.code, e.details?.reason]).toEqual(['VALIDATION', 'stage_not_in_flow'])
    expect(dumpTables(h.db, ['task', 'project_item', 'activity'])).toEqual(before)
    expect(h.events).toHaveLength(0)
  })

  it('projeto inexistente é NOT_FOUND', () => {
    const h = setup()
    const id = feature(h)
    expect(errOf(() => moveTask(h.d, USER, { id, project_id: 'nao-existe' })).code).toBe(
      'NOT_FOUND'
    )
  })
})

describe('moveTask: aplicar', () => {
  it('keep mantém o fluxo e acrescenta no fim', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'P', flow_id: h.ids.flows.Bugfix })
    const a = feature(h)
    const b = feature(h)
    const before = raw(h.db, a)
    moveTask(h.d, USER, { id: a, project_id: p.id, choice: 'keep' })
    moveTask(h.d, USER, { id: b, project_id: p.id, choice: 'keep' })
    const now = raw(h.db, a)
    expect([now.project_id, now.flow_id, now.stage_id]).toEqual([
      p.id,
      before.flow_id,
      before.stage_id
    ])
    expect(items(h.db, p.id)).toEqual([
      { task_id: a, rank: 'a0' },
      { task_id: b, rank: 'a1' }
    ])
  })

  it('projeto sem fluxo, ou do mesmo fluxo, não pergunta', () => {
    const h = setup()
    const sem = createProject(h.d, USER, { name: 'sem' })
    const igual = createProject(h.d, USER, { name: 'igual', flow_id: h.ids.flows.Feature })
    const a = feature(h)
    const b = feature(h)
    expect(moveTask(h.d, USER, { id: a, project_id: sem.id }).activity_id).not.toBeNull()
    expect(moveTask(h.d, USER, { id: b, project_id: igual.id }).activity_id).not.toBeNull()
    expect(raw(h.db, a).project_id).toBe(sem.id)
    expect(raw(h.db, b).project_id).toBe(igual.id)
  })

  it('mesmo projeto é no-op: sem escrita, sem evento, sem activity', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'P' })
    const a = feature(h)
    const avulsa = feature(h)
    moveTask(h.d, USER, { id: a, project_id: p.id })
    h.tick(MIN)
    const tables = ['task', 'project_item', 'activity']
    const before = dumpTables(h.db, tables)
    h.events.length = 0
    expect(moveTask(h.d, USER, { id: a, project_id: p.id }).activity_id).toBeNull()
    expect(moveTask(h.d, USER, { id: avulsa, project_id: null }).activity_id).toBeNull()
    expect(h.events).toHaveLength(0)
    expect(dumpTables(h.db, tables)).toEqual(before)
  })

  it('entre projetos: troca o item, guarda o antigo no inverso e emite os dois projetos', () => {
    const h = setup()
    const p1 = createProject(h.d, USER, { name: 'P1' })
    const p2 = createProject(h.d, USER, { name: 'P2' })
    const x = feature(h)
    const a = feature(h)
    moveTask(h.d, USER, { id: x, project_id: p1.id })
    moveTask(h.d, USER, { id: a, project_id: p1.id })
    h.events.length = 0
    const r = moveTask(h.d, USER, { id: a, project_id: p2.id })
    expect(items(h.db, p1.id)).toEqual([{ task_id: x, rank: 'a0' }])
    expect(items(h.db, p2.id)).toEqual([{ task_id: a, rank: 'a0' }])
    const inv = readActivity(h.db, r.activity_id!)!.inverse!
    expect(inv.expect).toEqual({ project_id: p2.id })
    expect(inv.restore).toEqual({ project_id: p1.id, item: { project_id: p1.id, rank: 'a1' } })
    expect(h.events).toContainEqual({ entity: 'task', ids: [a], op: 'upsert' })
    for (const p of [p1, p2])
      expect(h.events).toContainEqual({ entity: 'project', ids: [p.id], op: 'upsert' })
  })

  it('tirar do projeto (project_id null) remove o item e guarda o antigo', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'P', flow_id: h.ids.flows.Bugfix })
    const a = feature(h)
    moveTask(h.d, USER, { id: a, project_id: p.id, choice: 'keep' })
    const r = moveTask(h.d, USER, { id: a, project_id: null })
    expect(raw(h.db, a).project_id).toBeNull()
    expect(items(h.db, p.id)).toEqual([])
    expect(readActivity(h.db, r.activity_id!)!.inverse!.restore).toEqual({
      project_id: p.id,
      item: { project_id: p.id, rank: 'a0' }
    })
  })

  it('task apagada não move', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'P' })
    const a = feature(h)
    deleteTask(h.d, USER, { id: a })
    expect(errOf(() => moveTask(h.d, USER, { id: a, project_id: p.id })).code).toBe('NOT_FOUND')
  })
})

describe('projetos', () => {
  it('criar task no projeto: o projeto precede o tipo e o item entra no fim', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'P', flow_id: h.ids.flows.Bugfix })
    const id = createTask(h.d, USER, {
      title: 't',
      type_id: h.ids.types.Feature,
      project_id: p.id
    }).row!.id
    expect(raw(h.db, id).flow_id).toBe(h.ids.flows.Bugfix)
    expect(items(h.db, p.id)).toEqual([{ task_id: id, rank: 'a0' }])
  })

  it('apagar projeto não apaga task', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'Meu projeto' })
    const live = feature(h)
    const dead = feature(h)
    moveTask(h.d, USER, { id: live, project_id: p.id })
    moveTask(h.d, USER, { id: dead, project_id: p.id })
    deleteTask(h.d, USER, { id: dead })
    h.events.length = 0
    const r = deleteProject(h.d, USER, { id: p.id })
    expect(r.deleted).toBe(true)
    expect([...r.task_ids].sort()).toEqual([live, dead].sort())
    for (const id of [live, dead]) expect(raw(h.db, id).project_id).toBeNull()
    expect(raw(h.db, dead).deleted_at).not.toBeNull()
    expect(h.db.prepare('select count(*) as n from project_item').get()).toEqual({ n: 0 })
    expect(listProjects(h.d).map((x) => x.id)).not.toContain(p.id)
    expect(h.events).toContainEqual({ entity: 'project', ids: [p.id], op: 'delete' })
    expect(h.events).toContainEqual({ entity: 'task', ids: [live], op: 'upsert' })
    expect(listTasks(h.d, { ids: [live] })).toHaveLength(1)

    const act = h.db.prepare("select id from activity where op = 'project_delete'").get() as {
      id: string
    }
    const a = readActivity(h.db, act.id)!
    expect(a.task_id).toBeNull()
    expect(a.inverse).toBeNull()
    expect(a.data.name).toBe('Meu projeto')
    expect([...(a.data.task_ids as string[])].sort()).toEqual([live, dead].sort())
  })

  it('apagar projeto inexistente é NOT_FOUND e não grava activity', () => {
    const h = setup()
    expect(errOf(() => deleteProject(h.d, USER, { id: 'x' })).code).toBe('NOT_FOUND')
    expect(h.db.prepare('select count(*) as n from activity').get()).toEqual({ n: 0 })
  })

  it('listProjects e getProject: contagens e itens por rank', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'P', goal: 'g', color: '#fff' })
    const a = feature(h)
    const b = feature(h)
    const c = feature(h)
    for (const id of [b, a, c]) moveTask(h.d, USER, { id, project_id: p.id })
    setStage(h.d, USER, { id: a, stage_id: h.ids.stages.Feature[3] })
    deleteTask(h.d, USER, { id: c })
    const row = listProjects(h.d).find((x) => x.id === p.id)!
    expect(row).toMatchObject({ name: 'P', goal: 'g', color: '#fff', flow_id: null, done_at: null })
    expect([row.task_count, row.done_count]).toEqual([2, 1])
    const det = getProject(h.d, p.id)
    expect(det.items.map((i) => i.task_id)).toEqual([b, a, c])
    expect(det.items.map((i) => i.rank)).toEqual(['a0', 'a1', 'a2'])
    expect(det.items[0]).toMatchObject({ kind: 'task', label: null })
    expect(errOf(() => getProject(h.d, 'x')).code).toBe('NOT_FOUND')
  })

  it('createProject e updateProject validam e só emitem se mudou', () => {
    const h = setup()
    expect(errOf(() => createProject(h.d, USER, { name: '  ' })).details?.reason).toBe(
      'name_required'
    )
    expect(errOf(() => createProject(h.d, USER, { name: 'x'.repeat(101) })).details?.reason).toBe(
      'too_long'
    )
    expect(errOf(() => createProject(h.d, USER, { name: 'a', goal: 'g'.repeat(2001) })).code).toBe(
      'VALIDATION'
    )
    expect(errOf(() => createProject(h.d, USER, { name: 'a', flow_id: 'x' })).code).toBe(
      'NOT_FOUND'
    )
    const p = createProject(h.d, USER, { name: ' P ' })
    expect(p.name).toBe('P')
    h.events.length = 0
    updateProject(h.d, USER, { id: p.id, name: 'P' })
    expect(h.events).toHaveLength(0)
    const u = updateProject(h.d, USER, { id: p.id, goal: 'meta', color: null })
    expect(u.goal).toBe('meta')
    expect(h.events).toEqual([{ entity: 'project', ids: [p.id], op: 'upsert' }])
  })

  it('mudar o fluxo do projeto não mexe em task existente (fluxo congelado)', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'P' })
    const a = feature(h)
    moveTask(h.d, USER, { id: a, project_id: p.id })
    const before = dumpTables(h.db, ['task'])
    const u = updateProject(h.d, USER, { id: p.id, flow_id: h.ids.flows.Bugfix })
    expect(u.flow_id).toBe(h.ids.flows.Bugfix)
    expect(dumpTables(h.db, ['task'])).toEqual(before)
    const e = errOf(() => moveTask(h.d, USER, { id: feature(h), project_id: p.id }))
    expect(e.details?.reason).toBe('choose_keep_adopt')
  })
})
