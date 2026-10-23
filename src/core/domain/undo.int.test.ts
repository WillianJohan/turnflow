import { describe, expect, it } from 'vitest'
import { ActivityRow } from '../../shared/contracts'
import type { DomainChanged } from '../../shared/ipc/events'
import type { Db } from '../db/open'
import { dumpTables, insertMcpClient, openTestDb, seedIds } from '../testing/db'
import { readActivity } from './activity'
import { DAY_MS } from './attention'
import { addCheckpoint } from './checkpoint'
import { createDomain, type Actor, type DomainDeps, type RemotePort } from './context'
import { DomainError } from './errors'
import { deleteStage, saveStage, setTaskFlow } from './flow'
import { createProject, deleteProject, moveTask } from './project'
import { listTasks, type TaskRecord } from './rows'
import { blockTask, unblockTask } from './block'
import { closeTask, createTask, deleteTask, setStage, updateTask } from './task'
import { dismissTask, noteUserPrompt } from './turn'
import { INVERSE_OF, UNDO_WINDOW_MS, listActivity, undoActivity } from './undo'

const T0 = Date.parse('2026-10-22T12:00:00.000Z')
const MIN = 60_000
const HOUR = 60 * MIN
const USER: Actor = { kind: 'user' }

type Harness = {
  db: Db
  d: DomainDeps
  events: DomainChanged[]
  ids: ReturnType<typeof seedIds>
  mcp: Actor
  tick: (ms: number) => void
  nowIso: () => string
}

function setup(o: { remote?: RemotePort } = {}): Harness {
  const db = openTestDb()
  const events: DomainChanged[] = []
  let t = T0
  const d = createDomain({
    db,
    afterCommit: (c) => events.push(c),
    now: () => new Date(t),
    remote: o.remote
  })
  return {
    db,
    d,
    events,
    ids: seedIds(db),
    mcp: { kind: 'mcp', client_id: insertMcpClient(db) },
    tick: (ms) => (t += ms),
    nowIso: () => new Date(t).toISOString()
  }
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

/** Estado inteiro da task (menos `touched_at`) + o item de projeto dela. */
const snap = (db: Db, id: string): Record<string, unknown> => {
  const { touched_at, ...task } = raw(db, id)
  void touched_at
  const item =
    db.prepare('select project_id, rank from project_item where task_id = ?').get(id) ?? null
  return { task, item }
}

const items = (db: Db, projectId: string): { task_id: string; rank: string }[] =>
  db
    .prepare('select task_id, rank from project_item where project_id = ? order by rank, id')
    .all(projectId) as { task_id: string; rank: string }[]

const outbox = (db: Db): Record<string, unknown>[] =>
  db.prepare('select * from sync_outbox order by id').all() as Record<string, unknown>[]

const feature = (h: Harness, project_id?: string): string =>
  createTask(h.d, USER, { title: 't', type_id: h.ids.types.Feature, project_id }).row!.id

const F = (h: Harness, i: number): string => h.ids.stages.Feature[i]

const rowOf = (h: Harness, activityId: string, task_id?: string): ActivityRow => {
  const r = listActivity(h.d, { task_id, limit: 200 }).find((x) => x.id === activityId)
  if (!r) throw new Error('activity fora da lista')
  return ActivityRow.parse(r)
}

/** O mapa do brief, literal: o `INVERSE_OF` tem que ser exatamente este. */
const EXPECTED_INVERSE: Record<string, string> = {
  restore_turn: 'clear_turn',
  clear_turn: 'restore_turn',
  undelete: 'redelete',
  redelete: 'undelete',
  unblock: 'block',
  block: 'unblock',
  set_stage: 'set_stage',
  move_project: 'move_project'
}

const TABLES = ['task', 'activity', 'sync_outbox', 'project_item']

/** CONFLICT com `reason`, sem escrever nem emitir. */
function expectRefused(h: Harness, activityId: string, reason: string, actor: Actor = USER): void {
  const before = dumpTables(h.db, TABLES)
  h.events.length = 0
  const e = errOf(() => undoActivity(h.d, actor, { activity_id: activityId }))
  expect([e.code, e.details?.reason]).toEqual(['CONFLICT', reason])
  expect(dumpTables(h.db, TABLES)).toEqual(before)
  expect(h.events).toHaveLength(0)
}

/** Faz a operação, confere que mudou, desfaz e confere que o estado voltou (menos `touched_at`). */
function roundTrip(h: Harness, id: string, op: () => string | null): string {
  h.tick(MIN)
  const before = snap(h.db, id)
  const aid = op()
  expect(aid).not.toBeNull()
  expect(snap(h.db, id)).not.toEqual(before)
  h.tick(MIN)
  const r = undoActivity(h.d, USER, { activity_id: aid! })
  expect(snap(h.db, id)).toEqual(before)
  expect(raw(h.db, id).touched_at).toBe(h.nowIso())
  const orig = readActivity(h.db, aid!)!
  expect(orig.undone_by_activity_id).toBe(r.activity_id)
  expect(orig.undone_at).toBe(h.nowIso())
  const undo = readActivity(h.db, r.activity_id!)!
  expect(undo.op).toBe('undo')
  expect(undo.data.of).toBe(aid)
  expect(undo.inverse!.op).toBe(EXPECTED_INVERSE[orig.inverse!.op])
  return r.activity_id!
}

describe('as 6 operações vão e voltam', () => {
  it('INVERSE_OF é o mapa do brief', () => {
    expect(INVERSE_OF).toEqual(EXPECTED_INVERSE)
  })

  it('dispensar', () => {
    const h = setup()
    const id = feature(h)
    blockTask(h.d, USER, { id, reason: 'x' })
    unblockTask(h.d, h.mcp, { id }) // liga desbloqueada
    expect(raw(h.db, id).turn_reason).toBe('desbloqueada')
    roundTrip(h, id, () => dismissTask(h.d, USER, { id }).activity_id)
    const row = listTasks(h.d, 'attention').find((r) => r.id === id)!
    expect(row.reason?.kind).toBe('desbloqueada')
  })

  it('apagar', () => {
    const h = setup()
    const id = feature(h)
    roundTrip(h, id, () => deleteTask(h.d, USER, { id }).activity_id)
    expect(listTasks(h.d, 'attention').map((r) => r.id)).toContain(id)
  })

  it('transição (avançar, com vez limpa)', () => {
    const h = setup()
    const id = feature(h)
    setStage(h.d, USER, { id, stage_id: F(h, 2) })
    setStage(h.d, h.mcp, { id, stage_id: F(h, 1) }) // voltou
    expect(raw(h.db, id).turn_reason).toBe('voltou')
    roundTrip(h, id, () => setStage(h.d, USER, { id, stage_id: F(h, 2) }).activity_id)
    const row = listTasks(h.d, 'attention').find((r) => r.id === id)!
    expect([row.stage.id, row.reason?.kind]).toEqual([F(h, 1), 'voltou'])
  })

  it('transição para trás pela IA (voltou)', () => {
    const h = setup()
    const id = feature(h)
    setStage(h.d, USER, { id, stage_id: F(h, 2) })
    roundTrip(h, id, () => setStage(h.d, h.mcp, { id, stage_id: F(h, 1) }).activity_id)
    expect(raw(h.db, id).turn_reason).toBeNull()
  })

  it('encerrar', () => {
    const h = setup()
    const id = feature(h)
    roundTrip(h, id, () => closeTask(h.d, USER, { id }).activity_id)
    const row = listTasks(h.d, 'attention').find((r) => r.id === id)!
    expect(row.stage.id).toBe(F(h, 0))
    expect(raw(h.db, id).done_at).toBeNull()
  })

  it('mover de projeto (keep)', () => {
    const h = setup()
    const a = createProject(h.d, USER, { name: 'A' })
    const b = createProject(h.d, USER, { name: 'B' })
    const id = feature(h, a.id)
    roundTrip(h, id, () => moveTask(h.d, USER, { id, project_id: b.id }).activity_id)
    expect(listTasks(h.d, { project_id: a.id }).map((r) => r.id)).toEqual([id])
    expect(items(h.db, b.id)).toEqual([])
  })

  it('mover de projeto (adopt), partindo de outro projeto: volta item, fluxo e etapa', () => {
    const h = setup()
    const a = createProject(h.d, USER, { name: 'A' })
    const b = createProject(h.d, USER, { name: 'B', flow_id: h.ids.flows.Bugfix })
    const id = feature(h, a.id)
    setStage(h.d, USER, { id, stage_id: F(h, 1) })
    roundTrip(
      h,
      id,
      () =>
        moveTask(h.d, USER, {
          id,
          project_id: b.id,
          choice: 'adopt',
          mapping: { [F(h, 1)]: h.ids.stages.Bugfix[1] }
        }).activity_id
    )
    expect(raw(h.db, id).flow_id).toBe(h.ids.flows.Feature)
    expect(items(h.db, a.id)).toEqual([{ task_id: id, rank: 'a0' }])
    expect(items(h.db, b.id)).toEqual([])
  })

  it('bloquear', () => {
    const h = setup()
    const id = feature(h)
    roundTrip(h, id, () => blockTask(h.d, USER, { id, reason: 'x' }).activity_id)
    expect(listTasks(h.d, 'attention').find((r) => r.id === id)!.blocked_reason).toBeNull()
  })

  it('trocar o motivo do bloqueio volta o motivo anterior', () => {
    const h = setup()
    const id = feature(h)
    blockTask(h.d, USER, { id, reason: 'x' })
    roundTrip(h, id, () => blockTask(h.d, USER, { id, reason: 'y' }).activity_id)
    expect(raw(h.db, id).blocked_reason).toBe('x')
  })

  it('desbloquear pela IA (tira o desbloqueada junto)', () => {
    const h = setup()
    const id = feature(h)
    blockTask(h.d, USER, { id, reason: 'x' })
    roundTrip(h, id, () => unblockTask(h.d, h.mcp, { id }).activity_id)
    const t = raw(h.db, id)
    expect([t.blocked_reason, t.turn_reason]).toEqual(['x', null])
  })
})

describe('Desfazer do Desfazer', () => {
  it('transição desfeita e o undo desfeito: etapa nova de volta', () => {
    const h = setup()
    const id = feature(h)
    const x = setStage(h.d, USER, { id, stage_id: F(h, 1) }).activity_id!
    h.tick(MIN)
    const u = undoActivity(h.d, USER, { activity_id: x })
    expect(raw(h.db, id).stage_id).toBe(F(h, 0))
    h.tick(MIN)
    const r = undoActivity(h.d, USER, { activity_id: u.activity_id! })
    expect(raw(h.db, id).stage_id).toBe(F(h, 1))
    expect(r.row!.stage.id).toBe(F(h, 1))
    expect(readActivity(h.db, u.activity_id!)!.undone_by_activity_id).toBe(r.activity_id)
    // o original continua desfeito: não volta a ser desfazível
    expect(rowOf(h, x).undoable).toBe(false)
  })

  it('apagar → desfazer → desfazer reapaga e devolve row null', () => {
    const h = setup()
    const id = feature(h)
    const x = deleteTask(h.d, USER, { id }).activity_id!
    const u = undoActivity(h.d, USER, { activity_id: x })
    expect(u.row?.id).toBe(id)
    h.tick(MIN)
    h.events.length = 0
    const r = undoActivity(h.d, USER, { activity_id: u.activity_id! })
    expect(r.row).toBeNull()
    expect(raw(h.db, id).deleted_at).not.toBeNull()
    expect(h.events).toContainEqual({ entity: 'task', ids: [id], op: 'delete' })
    expect(listTasks(h.d, 'attention').map((t) => t.id)).not.toContain(id)
  })

  it('mover → desfazer → desfazer: item de novo no destino', () => {
    const h = setup()
    const a = createProject(h.d, USER, { name: 'A' })
    const b = createProject(h.d, USER, { name: 'B' })
    const id = feature(h, a.id)
    const x = moveTask(h.d, USER, { id, project_id: b.id }).activity_id!
    const u = undoActivity(h.d, USER, { activity_id: x })
    expect(raw(h.db, id).project_id).toBe(a.id)
    undoActivity(h.d, USER, { activity_id: u.activity_id! })
    expect(raw(h.db, id).project_id).toBe(b.id)
    expect(items(h.db, b.id)).toEqual([{ task_id: id, rank: 'a0' }])
    expect(items(h.db, a.id)).toEqual([])
  })
})

describe('conflito por expect', () => {
  it('IA muda a etapa, eu mudo de novo: bloqueado com "mudou depois (por você)" e banco idêntico', () => {
    const h = setup()
    const id = feature(h)
    const ia = setStage(h.d, h.mcp, { id, stage_id: F(h, 1) }).activity_id!
    h.tick(MIN)
    setStage(h.d, USER, { id, stage_id: F(h, 2) })
    // escrita mais nova da IA que não cruza o expect não muda o rótulo
    blockTask(h.d, h.mcp, { id, reason: 'x' })
    const row = rowOf(h, ia, id)
    expect(row.undoable).toBe(false)
    expect(row.undo_blocked_reason).toBe('mudou depois (por você)')
    expectRefused(h, ia, 'changed_after')
  })

  it('o rótulo é do ator da escrita mais nova que cruza o expect', () => {
    const h = setup()
    const id = feature(h)
    const x = setStage(h.d, USER, { id, stage_id: F(h, 1) }).activity_id!
    setStage(h.d, USER, { id, stage_id: F(h, 2) })
    setStage(h.d, h.mcp, { id, stage_id: F(h, 3) })
    expect(rowOf(h, x).undo_blocked_reason).toBe('mudou depois (por IA)')
  })

  it('mudança sem Atividade (resposta à IA limpa a vez): "mudou depois" sem ator', () => {
    const h = setup()
    const id = feature(h)
    setStage(h.d, USER, { id, stage_id: F(h, 2) })
    const ia = setStage(h.d, h.mcp, { id, stage_id: F(h, 1) }).activity_id!
    h.tick(2 * MIN)
    expect(noteUserPrompt(h.d, id)).toBe(true)
    const row = rowOf(h, ia)
    expect(row.undoable).toBe(false)
    expect(row.undo_blocked_reason).toBe('mudou depois')
    expectRefused(h, ia, 'changed_after')
  })

  it('mudar e voltar ao mesmo valor não bloqueia (o expect bate de novo)', () => {
    const h = setup()
    const id = feature(h)
    const x = setStage(h.d, h.mcp, { id, stage_id: F(h, 1) }).activity_id!
    h.tick(MIN)
    setStage(h.d, USER, { id, stage_id: F(h, 2) })
    expect(rowOf(h, x).undoable).toBe(false)
    h.tick(MIN)
    setStage(h.d, USER, { id, stage_id: F(h, 1) }) // volta: stage_id e done_at batem de novo
    expect(rowOf(h, x).undoable).toBe(true)
    undoActivity(h.d, USER, { activity_id: x })
    expect(raw(h.db, id).stage_id).toBe(F(h, 0))
  })

  it('etapa a restaurar foi apagada: CONFLICT changed_after', () => {
    const h = setup()
    const id = feature(h)
    const x = setStage(h.d, h.mcp, { id, stage_id: F(h, 1) }).activity_id!
    // escritas minhas que cruzam o expect e voltam: o rótulo não pode culpar ninguém
    setStage(h.d, USER, { id, stage_id: F(h, 2) })
    setStage(h.d, USER, { id, stage_id: F(h, 1) })
    deleteStage(h.d, USER, { id: F(h, 0) })
    expect(raw(h.db, id).stage_id).toBe(F(h, 1)) // expect ainda bate
    expect(rowOf(h, x)).toMatchObject({ undoable: false, undo_blocked_reason: 'mudou depois' })
    expectRefused(h, x, 'changed_after')
  })

  it('task trocou de fluxo no meio: CONFLICT changed_after', () => {
    const h = setup()
    const id = feature(h)
    const x = setStage(h.d, USER, { id, stage_id: F(h, 1) }).activity_id!
    setTaskFlow(h.d, USER, {
      id,
      flow_id: h.ids.flows.Bugfix,
      mapping: { [F(h, 1)]: h.ids.stages.Bugfix[1] }
    })
    expect(rowOf(h, x).undo_blocked_reason).toBe('mudou depois (por você)')
    expectRefused(h, x, 'changed_after')
  })

  it('etapa a restaurar virou final depois: CONFLICT changed_after (done_at não bateria)', () => {
    const h = setup()
    const id = feature(h)
    setStage(h.d, USER, { id, stage_id: F(h, 1) })
    const x = closeTask(h.d, USER, { id }).activity_id!
    const st = h.db.prepare('select * from flow_stage where id = ?').get(F(h, 1)) as {
      flow_id: string
      name: string
      short_name: string
      waits_other: number
    }
    saveStage(h.d, USER, {
      flow_id: st.flow_id,
      id: F(h, 1),
      name: st.name,
      short_name: st.short_name,
      waits_other: st.waits_other === 1,
      is_final: true
    })
    expectRefused(h, x, 'changed_after')
  })

  it('projeto de origem apagado depois de mover: CONFLICT changed_after', () => {
    const h = setup()
    const a = createProject(h.d, USER, { name: 'A' })
    const b = createProject(h.d, USER, { name: 'B' })
    const id = feature(h, a.id)
    const x = moveTask(h.d, USER, { id, project_id: b.id }).activity_id!
    deleteProject(h.d, USER, { id: a.id })
    expect(raw(h.db, id).project_id).toBe(b.id) // expect ainda bate
    expectRefused(h, x, 'changed_after')
  })
})

describe('recusas', () => {
  it('segundo Desfazer da mesma activity: CONFLICT already_undone', () => {
    const h = setup()
    const id = feature(h)
    const x = blockTask(h.d, USER, { id, reason: 'x' }).activity_id!
    undoActivity(h.d, USER, { activity_id: x })
    expect(rowOf(h, x)).toMatchObject({ undoable: false, undo_blocked_reason: 'Já foi desfeito' })
    // mesmo com o expect batendo de novo, não aplica duas vezes
    blockTask(h.d, USER, { id, reason: 'x' })
    expectRefused(h, x, 'already_undone')
  })

  it('7 dias: +7 d +1 min expira sem motivo; +6 d 23 h ainda desfaz', () => {
    expect(UNDO_WINDOW_MS).toBe(7 * DAY_MS)
    const h = setup()
    const id = feature(h)
    const x = blockTask(h.d, USER, { id, reason: 'x' }).activity_id!
    h.tick(6 * DAY_MS + 23 * HOUR)
    expect(rowOf(h, x).undoable).toBe(true)
    h.tick(HOUR + MIN)
    const row = rowOf(h, x)
    expect(row.undoable).toBe(false)
    expect('undo_blocked_reason' in row).toBe(false)
    expectRefused(h, x, 'expired')

    const id2 = feature(h)
    const y = blockTask(h.d, USER, { id: id2, reason: 'x' }).activity_id!
    h.tick(6 * DAY_MS + 23 * HOUR)
    undoActivity(h.d, USER, { activity_id: y })
    expect(raw(h.db, id2).blocked_reason).toBeNull()
  })

  it('exatamente 7 dias ainda desfaz (borda inclusiva)', () => {
    const h = setup()
    const id = feature(h)
    const x = blockTask(h.d, USER, { id, reason: 'x' }).activity_id!
    h.tick(UNDO_WINDOW_MS)
    expect(rowOf(h, x).undoable).toBe(true)
    undoActivity(h.d, USER, { activity_id: x })
    expect(raw(h.db, id).blocked_reason).toBeNull()
  })

  it('sem inverso não desfaz', () => {
    const h = setup()
    const p = createProject(h.d, USER, { name: 'P' })
    const create = createTask(h.d, USER, {
      title: 't',
      type_id: h.ids.types.Feature,
      project_id: p.id
    })
    const id = create.row!.id
    const update = updateTask(h.d, USER, id, { title: 'u' }).activity_id!
    const cp = addCheckpoint(h.d, USER, { task_id: id, text: 'c' }).activity_id!
    const flow = setTaskFlow(h.d, USER, {
      id,
      flow_id: h.ids.flows.Bugfix,
      mapping: { [F(h, 0)]: h.ids.stages.Bugfix[0] }
    }).activity_id!
    deleteStage(h.d, USER, { id: h.ids.stages.Bugfix[0], to_stage_id: h.ids.stages.Bugfix[1] })
    deleteProject(h.d, USER, { id: p.id })
    const opId = (op: string): string =>
      (h.db.prepare('select id from activity where op = ?').get(op) as { id: string }).id
    const all = [create.activity_id!, update, cp, flow, opId('stage_remap'), opId('project_delete')]
    for (const a of all) {
      const row = rowOf(h, a)
      expect(row.undoable).toBe(false)
      expect(row.undo_blocked_reason).toBeUndefined()
      expectRefused(h, a, 'not_undoable')
    }
  })

  it('etapa de task apagada: CONFLICT task_deleted; o undelete continua desfazível', () => {
    const h = setup()
    const id = feature(h)
    const x = setStage(h.d, USER, { id, stage_id: F(h, 1) }).activity_id!
    const del = deleteTask(h.d, USER, { id }).activity_id!
    expect(rowOf(h, x)).toMatchObject({
      undoable: false,
      undo_blocked_reason: 'A task foi apagada'
    })
    expectRefused(h, x, 'task_deleted')
    expect(rowOf(h, del).undoable).toBe(true)
    undoActivity(h.d, USER, { activity_id: del })
    expect(raw(h.db, id).deleted_at).toBeNull()
  })

  it('activity inexistente: NOT_FOUND', () => {
    const h = setup()
    const e = errOf(() => undoActivity(h.d, USER, { activity_id: 'nope' }))
    expect([e.code, e.details?.entity]).toEqual(['NOT_FOUND', 'activity'])
  })

  it('task do inverso inexistente: NOT_FOUND', () => {
    const h = setup()
    h.db
      .prepare(
        `insert into activity(id, at, actor, op, task_id, inverse, data)
         values ('a1', ?, 'user', 'task_block', null, ?, '{"fields":[]}')`
      )
      .run(h.nowIso(), JSON.stringify({ op: 'unblock', task_id: 'nope', expect: {}, restore: {} }))
    const e = errOf(() => undoActivity(h.d, USER, { activity_id: 'a1' }))
    expect([e.code, e.details?.entity]).toEqual(['NOT_FOUND', 'task'])
  })
})

describe('outbox', () => {
  const linked: RemotePort = { isLinked: () => true }

  it('pendente é cancelado, sem linha nova', () => {
    const h = setup({ remote: linked })
    const id = feature(h)
    const x = setStage(h.d, USER, { id, stage_id: F(h, 1) }).activity_id!
    const [o] = outbox(h.db)
    h.tick(MIN)
    const u = undoActivity(h.d, USER, { activity_id: x })
    const rows = outbox(h.db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ ...o, cancelled_at: h.nowIso() })
    expect(readActivity(h.db, u.activity_id!)!.inverse!.outbox_id).toBe(o.id)
  })

  it('desfazer o undo que cancelou enfileira a transição de novo', () => {
    const h = setup({ remote: linked })
    const id = feature(h)
    const x = setStage(h.d, USER, { id, stage_id: F(h, 1) }).activity_id!
    const u = undoActivity(h.d, USER, { activity_id: x }).activity_id!
    undoActivity(h.d, USER, { activity_id: u })
    const added = outbox(h.db).find((r) => r.idem_key === `undo:${u}`)!
    expect(JSON.parse(added.payload as string)).toEqual({ to_stage_id: F(h, 1) })
    expect([added.op, added.locked_at, added.done_at, added.cancelled_at]).toEqual([
      'transition',
      null,
      null,
      null
    ])
  })

  for (const col of ['locked_at', 'done_at'] as const) {
    it(`com ${col} (em voo/enviado) enfileira o inverso e não toca o original`, () => {
      const h = setup({ remote: linked })
      const id = feature(h)
      const x = setStage(h.d, USER, { id, stage_id: F(h, 1) }).activity_id!
      h.db.prepare(`update sync_outbox set ${col} = ?`).run(h.nowIso())
      const [o] = outbox(h.db)
      h.tick(MIN)
      const u = undoActivity(h.d, USER, { activity_id: x })
      const rows = outbox(h.db)
      expect(rows).toHaveLength(2)
      expect(rows.find((r) => r.id === o.id)).toEqual(o)
      const added = rows.find((r) => r.id !== o.id)!
      expect(added.idem_key).toBe(`undo:${x}`)
      expect(added.op).toBe('transition')
      expect(added.task_id).toBe(id)
      expect(added.created_at).toBe(h.nowIso())
      expect(JSON.parse(added.payload as string)).toEqual({ to_stage_id: F(h, 0) })
      expect([added.locked_at, added.done_at, added.cancelled_at]).toEqual([null, null, null])
      expect(readActivity(h.db, u.activity_id!)!.inverse!.outbox_id).toBe(added.id)

      // desfazer o undo com o inverso ainda pendente: cancela o inverso
      h.tick(MIN)
      undoActivity(h.d, USER, { activity_id: u.activity_id! })
      expect(outbox(h.db).find((r) => r.id === added.id)!.cancelled_at).toBe(h.nowIso())
      expect(outbox(h.db)).toHaveLength(2)
    })
  }

  it('transição sem outbox não cria linha no Desfazer', () => {
    const h = setup()
    const id = feature(h)
    const x = setStage(h.d, USER, { id, stage_id: F(h, 1) }).activity_id!
    undoActivity(h.d, USER, { activity_id: x })
    expect(raw(h.db, id).stage_id).toBe(F(h, 0))
    expect(outbox(h.db)).toEqual([])
  })
})

describe('atores e efeitos', () => {
  it('Desfazer de operação MCP pela UI', () => {
    const h = setup()
    const id = feature(h)
    const x = blockTask(h.d, h.mcp, { id, reason: 'x' }).activity_id!
    expect(readActivity(h.db, x)!.actor).toBe('mcp')
    const u = undoActivity(h.d, USER, { activity_id: x })
    const a = readActivity(h.db, u.activity_id!)!
    expect([a.actor, a.client_id]).toEqual(['user', null])
    expect(raw(h.db, id).blocked_reason).toBeNull()
  })

  it('mover de projeto volta o item com o rank antigo (empate de rank é aceito)', () => {
    const h = setup()
    const a = createProject(h.d, USER, { name: 'A' })
    const b = createProject(h.d, USER, { name: 'B' })
    for (let n = 0; n < 3; n++) feature(h, a.id)
    const id = feature(h, a.id)
    expect(items(h.db, a.id).find((i) => i.task_id === id)!.rank).toBe('a3')
    const x = moveTask(h.d, USER, { id, project_id: b.id }).activity_id!
    const late = feature(h, a.id) // ganha a3 também
    undoActivity(h.d, USER, { activity_id: x })
    const ranks = items(h.db, a.id)
    expect(
      ranks
        .filter((i) => i.rank === 'a3')
        .map((i) => i.task_id)
        .sort()
    ).toEqual([id, late].sort())
    expect(items(h.db, b.id)).toEqual([])
    expect(raw(h.db, id).project_id).toBe(a.id)
  })

  it('tirar do projeto e desfazer devolve o item', () => {
    const h = setup()
    const a = createProject(h.d, USER, { name: 'A' })
    const id = feature(h, a.id)
    roundTrip(h, id, () => moveTask(h.d, USER, { id, project_id: null }).activity_id)
    expect(items(h.db, a.id)).toEqual([{ task_id: id, rank: 'a0' }])
  })

  it('domain.changed: task e activity (as duas ids) depois do commit', () => {
    const h = setup()
    const a = createProject(h.d, USER, { name: 'A' })
    const b = createProject(h.d, USER, { name: 'B' })
    const id = feature(h, a.id)
    const x = moveTask(h.d, USER, { id, project_id: b.id }).activity_id!
    h.events.length = 0
    const u = undoActivity(h.d, USER, { activity_id: x })
    expect(h.events).toContainEqual({ entity: 'task', ids: [id], op: 'upsert' })
    const actIds = h.events.filter((e) => e.entity === 'activity').flatMap((e) => e.ids)
    expect(actIds).toEqual(expect.arrayContaining([u.activity_id, x]))
    const projIds = h.events.filter((e) => e.entity === 'project').flatMap((e) => e.ids)
    expect(projIds).toEqual(expect.arrayContaining([a.id, b.id]))
  })

  it('undo de apagar emite task/upsert', () => {
    const h = setup()
    const id = feature(h)
    const x = deleteTask(h.d, USER, { id }).activity_id!
    h.events.length = 0
    undoActivity(h.d, USER, { activity_id: x })
    expect(h.events).toContainEqual({ entity: 'task', ids: [id], op: 'upsert' })
  })

  it('o inverso do undo guarda expect = restore aplicado e restore = estado de antes', () => {
    const h = setup()
    const id = feature(h)
    const x = setStage(h.d, USER, { id, stage_id: F(h, 1) }).activity_id!
    const orig = readActivity(h.db, x)!.inverse!
    const u = undoActivity(h.d, USER, { activity_id: x })
    const inv = readActivity(h.db, u.activity_id!)!.inverse!
    expect(inv).toEqual({
      op: 'set_stage',
      task_id: id,
      expect: orig.restore,
      restore: orig.expect,
      outbox_id: null
    })
    expect(readActivity(h.db, u.activity_id!)!.data).toEqual({
      of: x,
      fields: Object.keys(orig.restore)
    })
  })
})

describe('listActivity', () => {
  it('por id desc, com before, limit (50 padrão, 200 máx) e filtro de task', () => {
    const h = setup()
    const ids: string[] = []
    for (let n = 0; n < 205; n++) ids.push(feature(h))
    const all = listActivity(h.d, {})
    expect(all).toHaveLength(50)
    const ordered = all.map((r) => r.id)
    expect(ordered).toEqual([...ordered].sort().reverse())
    expect(listActivity(h.d, { limit: 500 })).toHaveLength(200)
    expect(listActivity(h.d, { limit: 2 })).toHaveLength(2)
    const before = listActivity(h.d, { before: ordered[0], limit: 3 })
    expect(before.map((r) => r.id)).toEqual(ordered.slice(1, 4))
    const one = listActivity(h.d, { task_id: ids[7] })
    expect(one).toHaveLength(1)
    expect(ActivityRow.parse(one[0])).toMatchObject({
      task_id: ids[7],
      op: 'task_create',
      actor: 'user',
      summary: 'criou a task',
      undoable: false
    })
  })

  it('operação desfazível aparece com undoable:true e sem motivo', () => {
    const h = setup()
    const id = feature(h)
    const x = setStage(h.d, USER, { id, stage_id: F(h, 1) }).activity_id!
    const row = rowOf(h, x)
    expect(row.undoable).toBe(true)
    expect('undo_blocked_reason' in row).toBe(false)
    expect(row.summary).toContain('→')
  })
})
