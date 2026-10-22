import {
  Limits,
  type Flow,
  type SaveStageInput,
  type StageMapping,
  type StagePairing,
  type TaskType
} from '../../shared/contracts'
import { fold } from '../db/fold'
import type { Db } from '../db/open'
import { recordActivity } from './activity'
import { nowIso, type Actor, type DomainDeps, type Emit } from './context'
import { checkMax, domainError, notFound } from './errors'
import { liveTask, taskRow, type TaskRecord } from './rows'
import type { TaskCommandResult } from './task'

type StageRec = {
  id: string
  flow_id: string
  position: number
  name: string
  short_name: string
  waits_other: number
  is_final: number
  remote_star_status: string | null
}

const STAGE_COLS =
  'id, flow_id, position, name, short_name, waits_other, is_final, remote_star_status'

/** Etapas vivas do fluxo, na ordem (desempate por id, como em `rows.ts`). */
function liveStages(db: Db, flowId: string): StageRec[] {
  return db
    .prepare(
      `select ${STAGE_COLS} from flow_stage where flow_id = ? and deleted_at is null
       order by position, id`
    )
    .all(flowId) as StageRec[]
}

function requireFlow(db: Db, flowId: string): { id: string; name: string; is_default: number } {
  const f = db.prepare('select id, name, is_default from flow where id = ?').get(flowId) as
    { id: string; name: string; is_default: number } | undefined
  if (!f) throw notFound('flow', flowId)
  return f
}

function flowView(db: Db, flowId: string): Flow {
  const f = requireFlow(db, flowId)
  return {
    id: f.id,
    name: f.name,
    is_default: f.is_default === 1,
    stages: liveStages(db, flowId).map((s, i) => ({
      id: s.id,
      position: i + 1,
      name: s.name,
      short_name: s.short_name,
      waits_other: s.waits_other === 1,
      is_final: s.is_final === 1,
      remote_star_status: s.remote_star_status,
      live_task_count: liveTaskCount(db, s.id)
    }))
  }
}

export function listFlows(d: DomainDeps): Flow[] {
  const ids = d.db.prepare('select id from flow order by rowid').all() as { id: string }[]
  return ids.map((f) => flowView(d.db, f.id))
}

export function listTypes(d: DomainDeps): TaskType[] {
  const rows = d.db
    .prepare('select id, name, flow_id, syncs, icon, guideline from task_type order by rowid')
    .all() as (Omit<TaskType, 'syncs'> & { syncs: number })[]
  return rows.map((t) => ({ ...t, syncs: t.syncs === 1 }))
}

/**
 * Grava `position = índice + 1` na ordem dada, só onde mudou. Mantém as etapas vivas do fluxo com
 * posições únicas e contíguas (o banco não tem UNIQUE em `position`, e o `voltou` compara a coluna).
 */
function renumber(db: Db, order: string[]): number {
  const set = db.prepare('update flow_stage set position = ? where id = ? and position <> ?')
  return order.reduce((n, id, i) => n + set.run(i + 1, id, i + 1).changes, 0)
}

/** Fluxo mudou: `flow/upsert` e `task/upsert` das tasks vivas dele (a `StageRef` delas mudou). */
function emitFlow(db: Db, emit: Emit, flowId: string): void {
  emit({ entity: 'flow', ids: [flowId], op: 'upsert' })
  const ids = (
    db.prepare('select id from task where flow_id = ? and deleted_at is null').all(flowId) as {
      id: string
    }[]
  ).map((r) => r.id)
  if (ids.length > 0) emit({ entity: 'task', ids, op: 'upsert' })
}

const liveTaskCount = (db: Db, stageId: string): number =>
  (
    db
      .prepare('select count(*) as n from task where stage_id = ? and deleted_at is null')
      .get(stageId) as { n: number }
  ).n

function cleanName(field: 'name' | 'short_name', v: string): string {
  const t = v.trim()
  if (t === '') throw domainError('VALIDATION', 'name_required', { field })
  return checkMax(field, t, Limits.name)
}

/**
 * Cria (no fim, ou na `position`) ou atualiza uma etapa, e renumera as vivas 1..n. Mudar `is_final`
 * de etapa com task viva é `CONFLICT final_change_with_tasks`; desmarcar a única final é
 * `CONFLICT last_final`. Nada mudou: no-op (Decisão 10).
 */
export function saveStage(d: DomainDeps, actor: Actor, i: SaveStageInput): Flow {
  void actor
  const name = cleanName('name', i.name)
  const short_name = cleanName('short_name', i.short_name)
  const star =
    i.remote_star_status === undefined || i.remote_star_status === null
      ? i.remote_star_status
      : checkMax('remote_star_status', i.remote_star_status, Limits.name)
  const { db } = d
  d.tx((emit) => {
    requireFlow(db, i.flow_id)
    const stages = liveStages(db, i.flow_id)
    let id: string
    let changed = false
    if (i.id !== undefined) {
      const cur = stages.find((s) => s.id === i.id)
      if (!cur) throw notFound('stage', i.id)
      id = cur.id
      const finalChange = (cur.is_final === 1) !== i.is_final
      if (finalChange && !i.is_final && stages.filter((s) => s.is_final === 1).length === 1)
        throw domainError('CONFLICT', 'last_final', { stage_id: cur.id })
      if (finalChange && liveTaskCount(db, cur.id) > 0)
        throw domainError('CONFLICT', 'final_change_with_tasks', { stage_id: cur.id })
      const next = {
        name,
        short_name,
        waits_other: i.waits_other ? 1 : 0,
        is_final: i.is_final ? 1 : 0,
        remote_star_status: star === undefined ? cur.remote_star_status : star
      }
      if ((Object.keys(next) as (keyof typeof next)[]).some((k) => next[k] !== cur[k])) {
        db.prepare(
          `update flow_stage set name = @name, short_name = @short_name, waits_other = @waits_other,
           is_final = @is_final, remote_star_status = @remote_star_status where id = @id`
        ).run({ ...next, id })
        changed = true
      }
      // só tasks apagadas podem estar aqui: o done_at delas acompanha, para o desapagar ficar coerente
      if (finalChange)
        db.prepare(
          `update task set done_at = case when @fin then coalesce(done_at, @now) else null end
           where stage_id = @id`
        ).run({ fin: i.is_final ? 1 : 0, now: nowIso(d), id })
    } else {
      id = d.newId()
      db.prepare(
        `insert into flow_stage(id, flow_id, position, name, short_name, waits_other, is_final,
                                remote_star_status)
         values (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        i.flow_id,
        stages.length + 1,
        name,
        short_name,
        i.waits_other ? 1 : 0,
        i.is_final ? 1 : 0,
        star ?? null
      )
      changed = true
    }
    const order = stages.map((s) => s.id).filter((s) => s !== id)
    const at =
      i.position !== undefined
        ? Math.min(i.position - 1, order.length)
        : i.id !== undefined
          ? stages.findIndex((s) => s.id === id)
          : order.length
    order.splice(at, 0, id)
    if (renumber(db, order) > 0) changed = true
    if (changed) emitFlow(db, emit, i.flow_id)
  })
  return flowView(db, i.flow_id)
}

/**
 * Apaga (soft) uma etapa. Checagens nesta ordem (Decisão 15): última etapa → `last_stage`; última
 * final → `last_final`; com task (viva ou apagada) e sem destino → `stage_has_tasks` com
 * `{ task_count, deleted_count, suggested }` (`task_count` = total, apagadas incluídas). Com destino (etapa viva do mesmo fluxo, senão `VALIDATION`), move
 * todas as tasks sem tocar `touched_at` (Decisão 31), grava `stage_remap` por task viva e renumera.
 */
export function deleteStage(
  d: DomainDeps,
  actor: Actor,
  i: { id: string; to_stage_id?: string }
): Flow {
  const { db } = d
  const flowId = d.tx((emit) => {
    const st = db
      .prepare(`select ${STAGE_COLS} from flow_stage where id = ? and deleted_at is null`)
      .get(i.id) as StageRec | undefined
    if (!st) throw notFound('stage', i.id)
    const stages = liveStages(db, st.flow_id)
    if (stages.length === 1) throw domainError('CONFLICT', 'last_stage', { stage_id: st.id })
    if (st.is_final === 1 && stages.filter((s) => s.is_final === 1).length === 1)
      throw domainError('CONFLICT', 'last_final', { stage_id: st.id })
    const tasks = db.prepare('select * from task where stage_id = ?').all(st.id) as TaskRecord[]
    if (i.to_stage_id === undefined) {
      if (tasks.length > 0) {
        const at = stages.findIndex((s) => s.id === st.id)
        const suggested = (stages[at - 1] ?? stages[at + 1]).id
        throw domainError('CONFLICT', 'stage_has_tasks', {
          stage_id: st.id,
          task_count: tasks.length,
          deleted_count: tasks.filter((t) => t.deleted_at !== null).length,
          suggested
        })
      }
    } else {
      const to = stages.find((s) => s.id === i.to_stage_id && s.id !== st.id)
      if (!to) throw domainError('VALIDATION', 'stage_not_in_flow', { stage_id: i.to_stage_id })
      remapIn(d, emit, actor, tasks, st, to)
    }
    db.prepare('update flow_stage set deleted_at = ? where id = ?').run(nowIso(d), st.id)
    renumber(
      db,
      stages.filter((s) => s.id !== st.id).map((s) => s.id)
    )
    emitFlow(db, emit, st.flow_id)
    return st.flow_id
  })
  return flowView(db, flowId)
}

/**
 * Move as tasks (vivas e apagadas) da etapa que sai para `to`. `done_at` acompanha `is_final`;
 * `touched_at` e a vez ficam (Decisão 31). Atividade `stage_remap` sem inverso só por task viva.
 */
function remapIn(
  d: DomainDeps,
  emit: Emit,
  actor: Actor,
  tasks: TaskRecord[],
  from: StageRec,
  to: StageRec
): void {
  const now = nowIso(d)
  const set = d.db.prepare('update task set stage_id = ?, done_at = ? where id = ?')
  for (const t of tasks) {
    const done_at = to.is_final === 1 ? (t.done_at ?? now) : null
    set.run(to.id, done_at, t.id)
    if (t.deleted_at !== null) continue
    recordActivity(d, emit, actor, {
      op: 'stage_remap',
      task_id: t.id,
      fields: done_at === t.done_at ? ['stage_id'] : ['stage_id', 'done_at'],
      inverse: null,
      data: { from: from.name, to: to.name }
    })
  }
}

/** Par sugerido: mesmo `name` → mesmo `short_name` → final↔final (por `fold`), senão `null`. */
function suggestPair(s: StageRec, to: StageRec[]): string | null {
  const hit =
    to.find((t) => fold(t.name) === fold(s.name)) ??
    to.find((t) => fold(t.short_name) === fold(s.short_name)) ??
    (s.is_final === 1 ? to.find((t) => t.is_final === 1) : undefined)
  return hit?.id ?? null
}

/** Todas as etapas vivas do fluxo de origem, em ordem, com o par sugerido (Decisão 14). */
export function previewRemap(d: DomainDeps, fromFlowId: string, toFlowId: string): StagePairing[] {
  requireFlow(d.db, fromFlowId)
  requireFlow(d.db, toFlowId)
  const to = liveStages(d.db, toFlowId)
  return liveStages(d.db, fromFlowId).map((s, i) => ({
    from: { id: s.id, name: s.name, short_name: s.short_name, position: i + 1 },
    to_stage_id: suggestPair(s, to)
  }))
}

/**
 * Etapa da task no fluxo `toFlowId`: só `mapping[etapa atual]` conta (a sugestão da prévia nunca é
 * aplicada sozinha). Sem par: a prévia e a etapa atual em `missing`. Par fora das etapas vivas do
 * fluxo novo: `VALIDATION stage_not_in_flow`.
 */
export function remapTarget(
  d: DomainDeps,
  task: TaskRecord,
  toFlowId: string,
  mapping: StageMapping | undefined
): { stage_id: string } | { preview: StagePairing[]; missing: string[] } {
  requireFlow(d.db, toFlowId)
  const pick = mapping && Object.hasOwn(mapping, task.stage_id) ? mapping[task.stage_id] : null
  if (pick === null)
    return { preview: previewRemap(d, task.flow_id, toFlowId), missing: [task.stage_id] }
  const ok = d.db
    .prepare('select 1 from flow_stage where id = ? and flow_id = ? and deleted_at is null')
    .get(pick, toFlowId)
  if (!ok) throw domainError('VALIDATION', 'stage_not_in_flow', { stage_id: pick })
  return { stage_id: pick }
}

/**
 * Troca o fluxo da task. Mesmo fluxo é no-op; sem par para a etapa atual é
 * `CONFLICT remap_required` com `{ preview, missing }`. Aplica `flow_id`, `stage_id`, `done_at`,
 * toca, e grava `task_set_flow` sem inverso. Não mexe em `turn_*` de propósito: posição entre
 * fluxos diferentes não se compara, então não há "voltou" nem "avançou".
 */
export function setTaskFlow(
  d: DomainDeps,
  actor: Actor,
  i: { id: string; flow_id: string; mapping?: StageMapping }
): TaskCommandResult {
  const { db } = d
  const w = d.tx((emit) => {
    const rec = liveTask(db, i.id)
    const flow = requireFlow(db, i.flow_id)
    if (rec.flow_id === flow.id) return { task_id: rec.id, activity_id: null }
    const target = remapTarget(d, rec, flow.id, i.mapping)
    if (!('stage_id' in target))
      throw domainError('CONFLICT', 'remap_required', {
        preview: target.preview,
        missing: target.missing
      })
    const to = db.prepare('select is_final from flow_stage where id = ?').get(target.stage_id) as {
      is_final: number
    }
    const now = nowIso(d)
    const done_at = to.is_final === 1 ? (rec.done_at ?? now) : null
    db.prepare(
      'update task set flow_id = ?, stage_id = ?, done_at = ?, touched_at = ? where id = ?'
    ).run(flow.id, target.stage_id, done_at, now, rec.id)
    emit({ entity: 'task', ids: [rec.id], op: 'upsert' })
    const activity_id = recordActivity(d, emit, actor, {
      op: 'task_set_flow',
      task_id: rec.id,
      fields:
        done_at === rec.done_at ? ['flow_id', 'stage_id'] : ['flow_id', 'stage_id', 'done_at'],
      inverse: null,
      data: { from: requireFlow(db, rec.flow_id).name, to: flow.name }
    })
    return { task_id: rec.id, activity_id }
  })
  return { row: taskRow(d, w.task_id), activity_id: w.activity_id }
}
