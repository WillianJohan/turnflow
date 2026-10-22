import type { TurnReason } from '../../shared/contracts'
import { recordActivity } from './activity'
import { nowIso, type Actor, type DomainDeps } from './context'
import { liveTask, taskRow } from './rows'
import type { TaskCommandResult } from './task'

/** Prioridade do motivo da vez (Decisão 12): o maior não é rebaixado pelo menor. */
export const TURN_PRIORITY: Record<TurnReason, number> = {
  voltou: 3,
  desbloqueada: 2,
  atribuida: 1
}

/**
 * Liga ou sobe o motivo da vez. Vence o de maior prioridade e o `turn_at` fica o mais antigo,
 * então `turn_reason` e `turn_at` saem sempre juntos.
 */
export function raiseTurn(
  cur: { turn_reason: TurnReason | null; turn_at: string | null },
  next: TurnReason,
  nowIso: string
): { turn_reason: TurnReason; turn_at: string } {
  if (cur.turn_reason === null) return { turn_reason: next, turn_at: nowIso }
  const turn_at = cur.turn_at ?? nowIso
  const turn_reason = TURN_PRIORITY[next] > TURN_PRIORITY[cur.turn_reason] ? next : cur.turn_reason
  return { turn_reason, turn_at }
}

/**
 * Dispensa a vez. Sem `turn_reason` é no-op (Decisão 24: a Sua vez que vem só da sessão
 * `waiting` não se dispensa). Limpa `turn_*`, toca; inverso `restore_turn` (§4: o E11 preenche
 * `notification_ids`).
 */
export function dismissTask(d: DomainDeps, actor: Actor, i: { id: string }): TaskCommandResult {
  const w = d.tx((emit) => {
    const rec = liveTask(d.db, i.id)
    if (rec.turn_reason === null) return { task_id: rec.id, activity_id: null }
    d.db
      .prepare('update task set turn_reason = null, turn_at = null, touched_at = ? where id = ?')
      .run(nowIso(d), rec.id)
    emit({ entity: 'task', ids: [rec.id], op: 'upsert' })
    const activity_id = recordActivity(d, emit, actor, {
      op: 'task_dismiss',
      task_id: rec.id,
      fields: ['turn_reason', 'turn_at'],
      inverse: {
        op: 'restore_turn',
        task_id: rec.id,
        expect: { turn_reason: null, turn_at: null },
        restore: { turn_reason: rec.turn_reason, turn_at: rec.turn_at, notification_ids: [] }
      }
    })
    return { task_id: rec.id, activity_id }
  })
  return { row: taskRow(d, w.task_id), activity_id: w.activity_id }
}

const PROMPT_DEBOUNCE_MS = 60_000

/**
 * O usuário falou com a IA da task (E5). Sem vez e tocada há menos de 60 s: `false`, sem escrever.
 * Senão limpa `turn_*`, toca e emite `task/upsert`. Sem Atividade. Task apagada/inexistente: `false`.
 */
export function noteUserPrompt(d: DomainDeps, taskId: string): boolean {
  return d.tx((emit) => {
    const r = d.db
      .prepare(
        'select turn_reason, touched_at, created_at from task where id = ? and deleted_at is null'
      )
      .get(taskId) as
      { turn_reason: string | null; touched_at: string | null; created_at: string } | undefined
    if (!r) return false
    const touched = Date.parse(r.touched_at ?? r.created_at)
    if (r.turn_reason === null && d.now().getTime() - touched < PROMPT_DEBOUNCE_MS) return false
    d.db
      .prepare('update task set turn_reason = null, turn_at = null, touched_at = ? where id = ?')
      .run(nowIso(d), taskId)
    emit({ entity: 'task', ids: [taskId], op: 'upsert' })
    return true
  })
}
