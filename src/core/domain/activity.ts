import type { Db } from '../db/open'
import { nowIso, type Actor, type DomainDeps, type Emit } from './context'

/** Campos da task que um inverso pode conferir (`expect`) ou restaurar (`restore`). */
export type TaskField =
  | 'stage_id'
  | 'flow_id'
  | 'done_at'
  | 'turn_reason'
  | 'turn_at'
  | 'deleted_at'
  | 'project_id'
  | 'blocked_reason'
  | 'blocked_at'

export const TASK_FIELDS: ReadonlySet<string> = new Set<TaskField>([
  'stage_id',
  'flow_id',
  'done_at',
  'turn_reason',
  'turn_at',
  'deleted_at',
  'project_id',
  'blocked_reason',
  'blocked_at'
])

export type InverseOp =
  | 'restore_turn'
  | 'clear_turn'
  | 'undelete'
  | 'redelete'
  | 'set_stage'
  | 'move_project'
  | 'unblock'
  | 'block'

/**
 * Inverso de uma operação desfazível (§4, Decisão 11): `expect` = valores pós-operação de todos os
 * campos que ela mudou; `restore` = valores anteriores. `item` (mover de projeto) e
 * `notification_ids` (dispensar) ficam dentro de `restore`; só `outbox_id` fica no topo.
 */
export type Inverse = {
  op: InverseOp
  task_id: string
  expect: Partial<Record<TaskField, string | null>>
  restore: Partial<Record<TaskField, string | null>> & {
    item?: { project_id: string; rank: string } | null
    notification_ids?: string[]
  }
  outbox_id?: string | null
}

export type ActivityOp =
  | 'task_create'
  | 'task_update'
  | 'task_set_stage'
  | 'task_delete'
  | 'task_block'
  | 'task_unblock'
  | 'task_dismiss'
  | 'task_move'
  | 'task_set_flow'
  | 'checkpoint_add'
  | 'stage_remap'
  | 'project_delete'
  | 'task_import'
  | 'session_adopt'
  | 'session_end'
  | 'undo'

/**
 * Grava uma linha de Atividade e emite `activity/upsert`. `data` vira `{ fields, ...data }`:
 * `fields` são as chaves que a operação tocou (é o que acha o ator do "mudou depois").
 * `client_id` só existe para ator `mcp`. Devolve o id (o `id` pode vir pronto, para o `idem_key`).
 */
export function recordActivity(
  d: DomainDeps,
  emit: Emit,
  actor: Actor,
  a: {
    id?: string
    op: ActivityOp
    task_id: string | null
    fields: string[]
    inverse: Inverse | null
    data?: Record<string, unknown>
  }
): string {
  const id = a.id ?? d.newId()
  d.db
    .prepare(
      `insert into activity(id, at, actor, client_id, op, task_id, inverse, data)
       values (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      nowIso(d),
      actor.kind,
      actor.kind === 'mcp' ? actor.client_id : null,
      a.op,
      a.task_id,
      a.inverse ? JSON.stringify(a.inverse) : null,
      JSON.stringify({ ...a.data, fields: a.fields })
    )
  emit({ entity: 'activity', ids: [id], op: 'upsert' })
  return id
}

/** Valores atuais de `keys` na task (para montar `expect`/`restore` e conferir o Desfazer). */
export function readFields(
  db: Db,
  taskId: string,
  keys: TaskField[]
): Partial<Record<TaskField, string | null>> {
  if (keys.length === 0) return {}
  // as chaves entram no SQL: só nomes da lista fechada
  const bad = keys.find((k) => !TASK_FIELDS.has(k))
  if (bad) throw new Error(`readFields: campo desconhecido ${bad}`)
  const row = db.prepare(`select ${keys.join(', ')} from task where id = ?`).get(taskId) as
    Partial<Record<TaskField, string | null>> | undefined
  if (!row) throw new Error('readFields: task não existe')
  return row
}

export type ActivityRecord = {
  id: string
  at: string
  actor: Actor['kind']
  client_id: string | null
  op: ActivityOp
  task_id: string | null
  inverse: Inverse | null
  data: { fields: string[] } & Record<string, unknown>
  undone_at: string | null
  undone_by_activity_id: string | null
}

type ActivityDbRow = Omit<ActivityRecord, 'inverse' | 'data'> & {
  inverse: string | null
  data: string | null
}

export function readActivity(db: Db, id: string): ActivityRecord | null {
  const r = db
    .prepare(
      `select id, at, actor, client_id, op, task_id, inverse, data, undone_at, undone_by_activity_id
       from activity where id = ?`
    )
    .get(id) as ActivityDbRow | undefined
  if (!r) return null
  const data = r.data ? (JSON.parse(r.data) as Record<string, unknown>) : {}
  return {
    ...r,
    inverse: r.inverse ? (JSON.parse(r.inverse) as Inverse) : null,
    data: { ...data, fields: Array.isArray(data.fields) ? (data.fields as string[]) : [] }
  }
}
