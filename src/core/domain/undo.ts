import type { ActivityRow } from '../../shared/contracts'
import { DOMAIN_COPY } from '../../shared/copy/domain'
import type { Db } from '../db/open'
import {
  readActivity,
  readFields,
  recordActivity,
  type ActivityRecord,
  type Inverse,
  type InverseOp,
  type TaskField,
  TASK_FIELDS
} from './activity'
import { DAY_MS } from './attention'
import { nowIso, type Actor, type DomainDeps, type Emit } from './context'
import { domainError, notFound } from './errors'
import { taskRow } from './rows'
import type { TaskCommandResult, TaskWrite } from './task'

export const UNDO_WINDOW_MS = 7 * DAY_MS

/** Inverso do inverso: é o que o Desfazer grava para poder ser desfeito também. */
export const INVERSE_OF: Record<InverseOp, InverseOp> = {
  restore_turn: 'clear_turn',
  clear_turn: 'restore_turn',
  undelete: 'redelete',
  redelete: 'undelete',
  unblock: 'block',
  block: 'unblock',
  set_stage: 'set_stage',
  move_project: 'move_project'
}

export type UndoBlock =
  'not_undoable' | 'expired' | 'already_undone' | 'task_deleted' | 'changed_after'

export type UndoState = { undoable: boolean; code?: UndoBlock; label?: string }

type Values = Partial<Record<TaskField, string | null>>
type Item = { project_id: string; rank: string }

/**
 * Chaves de task de um `expect`/`restore`: só nomes da lista fechada `TASK_FIELDS`, porque viram
 * coluna no SQL dinâmico (`item` e `notification_ids` não são colunas e ficam de fora).
 */
const taskKeys = (v: Inverse['restore']): TaskField[] =>
  Object.keys(v).filter((k) => TASK_FIELDS.has(k)) as TaskField[]

/**
 * Se a activity pode ser desfeita agora, nesta ordem: sem inverso, fora da janela de 7 dias, já
 * desfeita, task apagada (menos o próprio `undelete`), e por fim conflito: algum campo do `expect`
 * mudou depois, ou o que o `restore` aponta (etapa, projeto) já não serve. Com `expect` divergente,
 * `label` é "mudou depois (por <ator>)" com o ator da escrita mais nova que tocou o `expect` (ou só
 * "mudou depois" sem Atividade que explique); com o destino inválido, sempre "mudou depois".
 */
export function undoState(d: DomainDeps, a: ActivityRecord): UndoState {
  const inv = a.inverse
  if (!inv) return { undoable: false, code: 'not_undoable' }
  if (d.now().getTime() - Date.parse(a.at) > UNDO_WINDOW_MS)
    return { undoable: false, code: 'expired' }
  if (a.undone_at !== null) return { undoable: false, code: 'already_undone' }
  const t = d.db.prepare('select flow_id, deleted_at from task where id = ?').get(inv.task_id) as
    { flow_id: string; deleted_at: string | null } | undefined
  if (!t || (t.deleted_at !== null && inv.op !== 'undelete'))
    return { undoable: false, code: 'task_deleted' }
  if (!expectHolds(d.db, inv))
    return {
      undoable: false,
      code: 'changed_after',
      label: DOMAIN_COPY.changedAfter(changedBy(d.db, a.id, inv))
    }
  // expect bate mas o destino sumiu: nenhuma escrita na task explica, então sem ator
  if (!restorable(d.db, inv, t.flow_id))
    return { undoable: false, code: 'changed_after', label: DOMAIN_COPY.changedAfter() }
  return { undoable: true }
}

/** Todo o `expect` (pós-estado completo dos campos que a operação mudou, Decisão 11) ainda vale. */
function expectHolds(db: Db, inv: Inverse): boolean {
  const keys = taskKeys(inv.expect)
  const cur = readFields(db, inv.task_id, keys)
  return keys.every((k) => cur[k] === (inv.expect[k] ?? null))
}

/**
 * O destino do `restore` ainda existe: a etapa está viva, é do fluxo que a task terá (o restaurado
 * ou o atual) e a finalidade dela bate com o `done_at` que fica; o projeto (e o do item) existe.
 */
function restorable(db: Db, inv: Inverse, curFlowId: string): boolean {
  const r = inv.restore
  if (r.stage_id !== undefined) {
    const flowId = r.flow_id !== undefined ? r.flow_id : curFlowId
    const st = db
      .prepare(
        'select is_final from flow_stage where id = ? and flow_id = ? and deleted_at is null'
      )
      .get(r.stage_id, flowId) as { is_final: number } | undefined
    if (!st) return false
    const doneAt =
      r.done_at !== undefined ? r.done_at : readFields(db, inv.task_id, ['done_at']).done_at
    if ((st.is_final === 1) !== (doneAt !== null && doneAt !== undefined)) return false
  }
  const projects = [r.project_id, r.item?.project_id].filter((p): p is string => !!p)
  const exists = db.prepare('select 1 from project where id = ?')
  return projects.every((p) => exists.get(p) !== undefined)
}

/** Rótulo do ator da activity mais nova da task (depois de `afterId`) que tocou o `expect`. */
function changedBy(db: Db, afterId: string, inv: Inverse): string | undefined {
  const keys = new Set<string>(taskKeys(inv.expect))
  const rows = db
    .prepare('select actor, data from activity where task_id = ? and id > ? order by id desc')
    .all(inv.task_id, afterId) as { actor: Actor['kind']; data: string | null }[]
  for (const r of rows) {
    const fields = (r.data ? (JSON.parse(r.data) as { fields?: unknown }).fields : null) ?? []
    if (Array.isArray(fields) && fields.some((f) => keys.has(f as string)))
      return DOMAIN_COPY.actor[r.actor]
  }
  return undefined
}

/** Motivo mostrado ao usuário: só o que explica algo (`not_undoable`/`expired` ficam sem). */
function blockedReason(s: UndoState): string | undefined {
  if (s.code === 'already_undone' || s.code === 'task_deleted') return DOMAIN_COPY.errors[s.code]
  if (s.code === 'changed_after') return s.label
  return undefined
}

/** Atividade por `id` desc (mais nova primeiro); `before` = id; `limit` 50, máx. 200. */
export function listActivity(
  d: DomainDeps,
  q: { task_id?: string; before?: string; limit?: number }
): ActivityRow[] {
  const limit = Math.min(Math.max(Math.trunc(q.limit ?? 50), 1), 200)
  const where: string[] = []
  const args: unknown[] = []
  if (q.task_id !== undefined) {
    where.push('task_id = ?')
    args.push(q.task_id)
  }
  if (q.before !== undefined) {
    where.push('id < ?')
    args.push(q.before)
  }
  const ids = d.db
    .prepare(
      `select id from activity ${where.length ? `where ${where.join(' and ')}` : ''}
       order by id desc limit ?`
    )
    .all(...args, limit) as { id: string }[]
  return ids.map(({ id }) => {
    const a = readActivity(d.db, id)!
    const s = undoState(d, a)
    const row: ActivityRow = {
      id: a.id,
      at: a.at,
      actor: a.actor,
      op: a.op,
      task_id: a.task_id,
      summary: DOMAIN_COPY.summary(a.op, a.data),
      undoable: s.undoable
    }
    const reason = blockedReason(s)
    if (reason !== undefined) row.undo_blocked_reason = reason
    return row
  })
}

/**
 * Desfaz uma activity numa transação só (Decisão 27): relê, confere (`CONFLICT` com
 * `details.reason` = código do `undoState`), aplica o `restore`, refaz o item de projeto, cancela
 * ou enfileira o inverso no outbox, toca `touched_at` e grava a activity `undo`, que tem o próprio
 * inverso e também pode ser desfeita. `row` é `null` quando a task termina apagada (Decisão 28).
 */
export function undoActivity(
  d: DomainDeps,
  actor: Actor,
  i: { activity_id: string }
): TaskCommandResult {
  const w = d.tx((emit) => undoIn(d, emit, actor, i.activity_id))
  return { row: taskRow(d, w.task_id), activity_id: w.activity_id }
}

function undoIn(d: DomainDeps, emit: Emit, actor: Actor, activityId: string): TaskWrite {
  const { db } = d
  const a = readActivity(db, activityId)
  if (!a) throw notFound('activity', activityId)
  const inv = a.inverse
  if (inv && !db.prepare('select 1 from task where id = ?').get(inv.task_id))
    throw notFound('task', inv.task_id)
  const s = undoState(d, a)
  if (!inv || !s.undoable)
    throw domainError('CONFLICT', s.code ?? 'not_undoable', s.label ? { label: s.label } : {})

  const id = inv.task_id
  const now = nowIso(d)
  const keys = taskKeys(inv.restore)
  const applied: Values = Object.fromEntries(keys.map((k) => [k, inv.restore[k] ?? null]))
  const before: Inverse['restore'] = readFields(db, id, keys)
  const isMove = inv.op === 'move_project'
  if (isMove) before.item = currentItem(db, id)

  const set = [...keys.map((k) => `${k} = @${k}`), 'touched_at = @now'].join(', ')
  db.prepare(`update task set ${set} where id = @id`).run({ ...applied, now, id })
  if (isMove) restoreItem(d, emit, id, before.item ?? null, inv.restore.item ?? null)
  const deleted = (
    db.prepare('select deleted_at from task where id = ?').get(id) as {
      deleted_at: string | null
    }
  ).deleted_at
  emit({ entity: 'task', ids: [id], op: deleted === null ? 'upsert' : 'delete' })

  const outbox_id = inv.op === 'set_stage' && inv.outbox_id ? revertOutbox(d, a.id, inv, now) : null
  const undoId = recordActivity(d, emit, actor, {
    op: 'undo',
    task_id: id,
    fields: keys,
    inverse: { op: INVERSE_OF[inv.op], task_id: id, expect: applied, restore: before, outbox_id },
    data: { of: a.id }
  })
  db.prepare('update activity set undone_at = ?, undone_by_activity_id = ? where id = ?').run(
    now,
    undoId,
    a.id
  )
  emit({ entity: 'activity', ids: [a.id], op: 'upsert' })
  return { task_id: id, activity_id: undoId }
}

function currentItem(db: Db, taskId: string): Item | null {
  return (
    (db.prepare('select project_id, rank from project_item where task_id = ?').get(taskId) as
      Item | undefined) ?? null
  )
}

/** Troca o item atual da task pelo do `restore`, com o rank antigo (empate com outro é aceito). */
function restoreItem(
  d: DomainDeps,
  emit: Emit,
  taskId: string,
  cur: Item | null,
  to: Item | null
): void {
  d.db.prepare('delete from project_item where task_id = ?').run(taskId)
  if (to)
    d.db
      .prepare(
        "insert into project_item(id, project_id, rank, kind, task_id) values (?, ?, ?, 'task', ?)"
      )
      .run(d.newId(), to.project_id, to.rank, taskId)
  const projects = new Set([cur?.project_id, to?.project_id].filter((p): p is string => !!p))
  for (const p of projects) emit({ entity: 'project', ids: [p], op: 'upsert' })
}

/**
 * Item do outbox da transição desfeita. Pendente (sem `locked_at`, `done_at`, `cancelled_at`):
 * cancela, e o remoto nunca vê a mudança. Em voo, enviado ou já cancelado (o Desfazer de um
 * Desfazer que cancelou): enfileira a transição para a etapa restaurada com
 * `idem_key = 'undo:<activity desfeita>'`. Devolve o item que representa este Desfazer no remoto.
 */
function revertOutbox(d: DomainDeps, undoneId: string, inv: Inverse, now: string): string {
  const o = d.db
    .prepare('select id, locked_at, done_at, cancelled_at from sync_outbox where id = ?')
    .get(inv.outbox_id) as
    | { id: string; locked_at: string | null; done_at: string | null; cancelled_at: string | null }
    | undefined
  if (o && o.locked_at === null && o.done_at === null && o.cancelled_at === null) {
    d.db.prepare('update sync_outbox set cancelled_at = ? where id = ?').run(now, o.id)
    return o.id
  }
  const id = d.newId()
  d.db
    .prepare(
      `insert into sync_outbox(id, task_id, op, payload, idem_key, created_at)
       values (?, ?, 'transition', ?, ?, ?)`
    )
    .run(
      id,
      inv.task_id,
      JSON.stringify({ to_stage_id: inv.restore.stage_id }),
      `undo:${undoneId}`,
      now
    )
  return id
}
