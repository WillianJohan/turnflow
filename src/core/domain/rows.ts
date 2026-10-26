import {
  Group,
  type Checkpoint,
  type SessionRow,
  type SessionState,
  type StageRef,
  type TaskDetail,
  type TaskRow,
  type TurnReason
} from '../../shared/contracts'
import type { Db } from '../db/open'
import { attention, pickSession } from './attention'
import type { DomainDeps } from './context'
import { notFound } from './errors'

/** Linha crua da tabela `task` (todas as colunas). */
export type TaskRecord = {
  id: string
  key: string
  title: string
  description: string | null
  type_id: string
  flow_id: string
  stage_id: string
  project_id: string | null
  workdir: string | null
  blocked_reason: string | null
  blocked_at: string | null
  turn_reason: TurnReason | null
  turn_at: string | null
  sum_what: string | null
  sum_where: string | null
  sum_next: string | null
  sum_at: string | null
  sum_source: 'ai' | 'user' | 'engine' | null
  touched_at: string | null
  done_at: string | null
  deleted_at: string | null
  created_at: string
}

export type TaskScope =
  | 'attention'
  | { project_id: string }
  | { done_since?: string; limit?: number; offset?: number }
  | { ids: string[] }

type StageRecord = {
  id: string
  flow_id: string
  position: number
  name: string
  short_name: string
  waits_other: number
  is_final: number
  deleted_at: string | null
}

type LiveSession = {
  id: string
  task_id: string
  tool: string
  state: SessionState
  state_at: string
  ended_at: string | null
}

/** Task viva por id ou key; apagada ou inexistente é `NOT_FOUND`. */
export function liveTask(db: Db, idOrKey: string): TaskRecord {
  const r = (db.prepare('select * from task where id = ? and deleted_at is null').get(idOrKey) ??
    db.prepare('select * from task where key = ? and deleted_at is null').get(idOrKey)) as
    TaskRecord | undefined
  if (!r) throw notFound('task', idOrKey)
  return r
}

export function effectiveWorkdir(workdir: string | null, fallback: string | null): string | null {
  return workdir ?? fallback
}

const GROUP_ORDER = new Map(Group.options.map((g, i) => [g, i]))

/** Tasks vivas do escopo (nunca as apagadas), ordenadas por grupo e `sort_key`. */
export function listTasks(d: DomainDeps, scope: TaskScope): TaskRow[] {
  let where: string
  let args: unknown[] = []
  if (scope === 'attention') where = 'done_at is null'
  else if ('ids' in scope) {
    where = 'id in (select value from json_each(?))'
    args = [JSON.stringify(scope.ids)]
  } else if ('project_id' in scope) {
    where = 'project_id = ?'
    args = [scope.project_id]
  } else if (scope.done_since !== undefined) {
    where = 'done_at is not null and done_at >= ?'
    args = [scope.done_since]
  } else where = 'done_at is not null'
  // Concluídas crescem sem fim: com `limit`, página na ordem do grupo (done_at desc, id), que é a
  // mesma do sort_key de `concluida`
  let page = ''
  if (typeof scope === 'object' && 'limit' in scope && scope.limit !== undefined) {
    page = ' order by done_at desc, id asc limit ? offset ?'
    args = [...args, scope.limit, scope.offset ?? 0]
  }
  const recs = d.db
    .prepare(`select * from task where deleted_at is null and ${where}${page}`)
    .all(...args) as TaskRecord[]
  return buildRows(d, recs).sort(
    (a, b) =>
      GROUP_ORDER.get(a.group)! - GROUP_ORDER.get(b.group)! ||
      (a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : 0)
  )
}

/** Linha recalculada de uma task viva, ou `null` se ela não existe ou está apagada. */
export function taskRow(d: DomainDeps, id: string): TaskRow | null {
  return listTasks(d, { ids: [id] })[0] ?? null
}

export function getTask(d: DomainDeps, idOrKey: string): TaskDetail {
  const rec = liveTask(d.db, idOrKey)
  const [row] = buildRows(d, [rec])
  const checkpoints = d.db
    .prepare(
      'select id, at, text, source from checkpoint where task_id = ? order by at desc, id desc'
    )
    .all(rec.id) as Checkpoint[]
  const sessions = d.db
    .prepare(
      `select id, tool, external_id, state, state_at, started_at, ended_at, label
       from ai_session where task_id = ? order by started_at desc, id desc`
    )
    .all(rec.id) as SessionRow[]
  const flow = stagesByFlow(d.db, [rec.flow_id]).get(rec.flow_id) ?? []
  const live = flow.filter((s) => s.deleted_at === null)
  return {
    ...row,
    description: rec.description ?? '',
    sum_what: rec.sum_what,
    sum_at: rec.sum_at,
    sum_source: rec.sum_source,
    workdir: rec.workdir,
    workdir_effective: effectiveWorkdir(rec.workdir, d.defaultWorkdir()),
    checkpoints,
    sessions,
    remote: null,
    flow_stages: live.map((s) => stageRef(s, flow))
  }
}

export function attentionCounts(d: DomainDeps): {
  sua_vez: number
  pendente: number
  encaminhado: number
  fila_projeto: number
} {
  const n = { sua_vez: 0, pendente: 0, encaminhado: 0, fila_projeto: 0 }
  for (const r of listTasks(d, 'attention')) if (r.group !== 'concluida') n[r.group]++
  return n
}

const json = (xs: string[]): string => JSON.stringify(xs)

/** Etapas de cada fluxo; as vivas vêm por `position` (desempate por id) e as apagadas no fim. */
function stagesByFlow(db: Db, flowIds: string[]): Map<string, StageRecord[]> {
  const rows = db
    .prepare(
      `select id, flow_id, position, name, short_name, waits_other, is_final, deleted_at
       from flow_stage where flow_id in (select value from json_each(?))
       order by deleted_at is not null, position, id`
    )
    .all(json(flowIds)) as StageRecord[]
  const by = new Map<string, StageRecord[]>()
  for (const s of rows) by.set(s.flow_id, [...(by.get(s.flow_id) ?? []), s])
  return by
}

/** `position` = ordinal 1-based entre as vivas; `count` = quantas vivas (Decisão 17). */
function stageRef(s: StageRecord, flow: StageRecord[]): StageRef {
  const live = flow.filter((x) => x.deleted_at === null)
  const before = live.filter(
    (x) => x.position < s.position || (x.position === s.position && x.id < s.id)
  )
  return {
    id: s.id,
    name: s.name,
    short_name: s.short_name,
    position: before.length + 1,
    count: live.length,
    is_final: s.is_final === 1
  }
}

function buildRows(d: DomainDeps, recs: TaskRecord[]): TaskRow[] {
  if (recs.length === 0) return []
  const ids = json(recs.map((r) => r.id))
  const flows = stagesByFlow(d.db, [...new Set(recs.map((r) => r.flow_id))])
  const ranks = new Map(
    (
      d.db
        .prepare(
          'select task_id, rank from project_item where task_id in (select value from json_each(?))'
        )
        .all(ids) as { task_id: string; rank: string }[]
    ).map((r) => [r.task_id, r.rank])
  )
  const sessions = new Map<string, LiveSession[]>()
  for (const s of d.db
    .prepare(
      `select id, task_id, tool, state, state_at, ended_at from ai_session
       where ended_at is null and task_id in (select value from json_each(?))`
    )
    .all(ids) as LiveSession[])
    sessions.set(s.task_id, [...(sessions.get(s.task_id) ?? []), s])

  const now = d.now()
  return recs.map((r) => {
    const flow = flows.get(r.flow_id) ?? []
    const stage = flow.find((s) => s.id === r.stage_id)
    // invariante do domínio: toda task tem etapa do próprio fluxo (sem ULID na mensagem)
    if (!stage) throw new Error(`task ${r.key} sem etapa no próprio fluxo`)
    // coluna nullable desde a 0002: linha antiga vale pela criação (Decisão 29)
    const touched_at = r.touched_at ?? r.created_at
    const live = sessions.get(r.id) ?? []
    const att = attention(
      { ...r, touched_at },
      { waits_other: stage.waits_other === 1 },
      live,
      now,
      ranks.get(r.id) ?? null
    )
    const s = pickSession(live)
    return {
      id: r.id,
      key: r.key,
      title: r.title,
      type_id: r.type_id,
      project_id: r.project_id,
      stage: stageRef(stage, flow),
      group: att.group,
      reason: att.reason,
      blocked_reason: r.blocked_reason,
      session: s ? { id: s.id, tool: s.tool, state: s.state } : null,
      sum_where: r.sum_where,
      sum_next: r.sum_next,
      touched_at,
      faded: att.faded,
      sort_key: att.sort_key
    }
  })
}
