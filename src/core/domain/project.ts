import {
  Limits,
  type MoveInput,
  type ProjectDetail,
  type ProjectInput,
  type ProjectItem,
  type ProjectRow
} from '../../shared/contracts'
import type { Db } from '../db/open'
import { readFields, recordActivity, type Inverse, type TaskField } from './activity'
import { nowIso, type Actor, type DomainDeps, type Emit } from './context'
import { checkMax, domainError, notFound } from './errors'
import { cleanName, remapTarget } from './flow'
import { liveTask, taskRow } from './rows'
import { appendProjectItem, type TaskCommandResult } from './task'

type ProjectRec = {
  id: string
  name: string
  goal: string | null
  color: string | null
  flow_id: string | null
  done_at: string | null
}

const PROJECT_SELECT = `
  select p.id, p.name, p.goal, p.color, p.flow_id, p.done_at,
    (select count(*) from task t where t.project_id = p.id and t.deleted_at is null) as task_count,
    (select count(*) from task t where t.project_id = p.id and t.deleted_at is null
       and t.done_at is not null) as done_count
  from project p`

function requireProject(db: Db, id: string): ProjectRec {
  const p = db
    .prepare('select id, name, goal, color, flow_id, done_at from project where id = ?')
    .get(id) as ProjectRec | undefined
  if (!p) throw notFound('project', id)
  return p
}

function projectRow(db: Db, id: string): ProjectRow {
  const r = db.prepare(`${PROJECT_SELECT} where p.id = ?`).get(id) as ProjectRow | undefined
  if (!r) throw notFound('project', id)
  return r
}

export function listProjects(d: DomainDeps): ProjectRow[] {
  return d.db.prepare(`${PROJECT_SELECT} order by p.rowid`).all() as ProjectRow[]
}

export function getProject(d: DomainDeps, id: string): ProjectDetail {
  const row = projectRow(d.db, id)
  const items = d.db
    .prepare(
      'select id, kind, task_id, label, rank from project_item where project_id = ? order by rank, id'
    )
    .all(id) as ProjectItem[]
  return { ...row, items }
}

function requireFlowId(db: Db, flowId: string): string {
  if (!db.prepare('select 1 from flow where id = ?').get(flowId)) throw notFound('flow', flowId)
  return flowId
}

/** Texto opcional: `''` e `null` viram `null`; passou do teto é `VALIDATION too_long`. */
function cleanOptional(field: string, v: string | null, max: number): string | null {
  return v === null || v === '' ? null : checkMax(field, v, max)
}

export function createProject(d: DomainDeps, actor: Actor, i: ProjectInput): ProjectRow {
  void actor
  const name = cleanName('name', i.name)
  const goal = cleanOptional('goal', i.goal ?? null, Limits.goal)
  const color = cleanOptional('color', i.color ?? null, Limits.color)
  const id = d.tx((emit) => {
    const flowId = i.flow_id ? requireFlowId(d.db, i.flow_id) : null
    const id = d.newId()
    d.db
      .prepare('insert into project(id, name, goal, color, flow_id) values (?, ?, ?, ?, ?)')
      .run(id, name, goal, color, flowId)
    emit({ entity: 'project', ids: [id], op: 'upsert' })
    return id
  })
  return projectRow(d.db, id)
}

/**
 * Edita só o que mudou (nada mudou: no-op, sem evento). Mudar `flow_id` não mexe em task
 * existente: o fluxo da task é congelado na criação, vale só para quem entra depois.
 */
export function updateProject(
  d: DomainDeps,
  actor: Actor,
  i: { id: string } & Partial<ProjectInput>
): ProjectRow {
  void actor
  const next: Partial<Omit<ProjectRec, 'id' | 'done_at'>> = {}
  if (i.name !== undefined) next.name = cleanName('name', i.name)
  if (i.goal !== undefined) next.goal = cleanOptional('goal', i.goal, Limits.goal)
  if (i.color !== undefined) next.color = cleanOptional('color', i.color, Limits.color)
  d.tx((emit) => {
    const cur = requireProject(d.db, i.id)
    if (i.flow_id !== undefined)
      next.flow_id = i.flow_id === null ? null : requireFlowId(d.db, i.flow_id)
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== cur[k])
    if (changed.length === 0) return
    d.db
      .prepare(`update project set ${changed.map((k) => `${k} = @${k}`).join(', ')} where id = @id`)
      .run({ ...next, id: cur.id })
    emit({ entity: 'project', ids: [cur.id], op: 'upsert' })
  })
  return projectRow(d.db, i.id)
}

/**
 * Apaga o projeto sem apagar task: remove os itens, zera `project_id` de todas as tasks (apagadas
 * incluídas, senão a FK segura o DELETE) e grava `project_delete` sem task e sem inverso. A
 * confirmação é do portão (`runCommand`, Decisão 9). `task/upsert` só das vivas.
 */
export function deleteProject(
  d: DomainDeps,
  actor: Actor,
  i: { id: string }
): { deleted: true; task_ids: string[] } {
  const { db } = d
  return d.tx((emit) => {
    const p = requireProject(db, i.id)
    const tasks = db
      .prepare('select id, deleted_at from task where project_id = ? order by rowid')
      .all(p.id) as { id: string; deleted_at: string | null }[]
    db.prepare('delete from project_item where project_id = ?').run(p.id)
    db.prepare('update task set project_id = null where project_id = ?').run(p.id)
    db.prepare('delete from project where id = ?').run(p.id)
    emit({ entity: 'project', ids: [p.id], op: 'delete' })
    const live = tasks.filter((t) => t.deleted_at === null).map((t) => t.id)
    if (live.length > 0) emit({ entity: 'task', ids: live, op: 'upsert' })
    const task_ids = tasks.map((t) => t.id)
    recordActivity(d, emit, actor, {
      op: 'project_delete',
      task_id: null,
      fields: [],
      inverse: null,
      data: { name: p.name, task_ids }
    })
    return { deleted: true as const, task_ids }
  })
}

/**
 * Move a task de projeto (`project_id: null` tira dele). Mesmo projeto é no-op. Projeto com fluxo
 * diferente do da task exige `choice`: `keep` mantém o fluxo, `adopt` leva a task para o do projeto
 * pela etapa de `mapping` (sem par: `remap_required`). Pergunta e validação vêm antes de qualquer
 * escrita. O item entra no fim da lista do destino; o inverso guarda o item antigo (Decisão 11).
 */
export function moveTask(d: DomainDeps, actor: Actor, i: MoveInput): TaskCommandResult {
  const w = d.tx((emit) => moveTaskIn(d, emit, actor, i))
  return { row: taskRow(d, w.task_id), activity_id: w.activity_id }
}

export function moveTaskIn(
  d: DomainDeps,
  emit: Emit,
  actor: Actor,
  i: MoveInput
): { task_id: string; activity_id: string | null } {
  const { db } = d
  const rec = liveTask(db, i.id)
  const to = i.project_id === null ? null : requireProject(db, i.project_id)
  if ((to?.id ?? null) === rec.project_id) return { task_id: rec.id, activity_id: null }

  let adopt: { stage_id: string } | null = null
  if (to?.flow_id && to.flow_id !== rec.flow_id) {
    if (i.choice === undefined)
      throw domainError('CONFLICT', 'choose_keep_adopt', { choice: ['keep', 'adopt'] })
    if (i.choice === 'adopt') {
      const target = remapTarget(d, rec, to.flow_id, i.mapping)
      if (!('stage_id' in target))
        throw domainError('CONFLICT', 'remap_required', {
          preview: target.preview,
          missing: target.missing
        })
      adopt = target
    }
  }

  const now = nowIso(d)
  const next: Partial<Record<TaskField, string | null>> = { project_id: to?.id ?? null }
  if (adopt && to?.flow_id) {
    const dest = db.prepare('select is_final from flow_stage where id = ?').get(adopt.stage_id) as {
      is_final: number
    }
    next.flow_id = to.flow_id
    next.stage_id = adopt.stage_id
    const done_at = dest.is_final === 1 ? (rec.done_at ?? now) : null
    if (done_at !== rec.done_at) next.done_at = done_at
  }
  const keys = Object.keys(next) as TaskField[]
  const restore: Inverse['restore'] = {
    ...readFields(db, rec.id, keys),
    item: oldItem(db, rec)
  }

  const from = rec.project_id === null ? null : requireProject(db, rec.project_id)
  db.prepare('delete from project_item where task_id = ?').run(rec.id)
  db.prepare(
    `update task set ${keys.map((k) => `${k} = @${k}`).join(', ')}, touched_at = @now where id = @id`
  ).run({ ...next, now, id: rec.id })
  if (to) appendProjectItem(d, to.id, rec.id)

  emit({ entity: 'task', ids: [rec.id], op: 'upsert' })
  for (const p of [from, to]) if (p) emit({ entity: 'project', ids: [p.id], op: 'upsert' })
  const activity_id = recordActivity(d, emit, actor, {
    op: 'task_move',
    task_id: rec.id,
    fields: keys,
    inverse: { op: 'move_project', task_id: rec.id, expect: next, restore },
    data: { from: from?.name ?? null, to: to?.name ?? null }
  })
  return { task_id: rec.id, activity_id }
}

/** Item atual da task (`{project_id, rank}`) ou `null` se ela não está em lista de projeto. */
function oldItem(db: Db, rec: { id: string }): { project_id: string; rank: string } | null {
  return (
    (db.prepare('select project_id, rank from project_item where task_id = ?').get(rec.id) as
      { project_id: string; rank: string } | undefined) ?? null
  )
}
