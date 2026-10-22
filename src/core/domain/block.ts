import { Limits } from '../../shared/contracts'
import { recordActivity, type Inverse, type TaskField } from './activity'
import { nowIso, type Actor, type DomainDeps } from './context'
import { checkMax, domainError } from './errors'
import { liveTask, taskRow } from './rows'
import type { TaskCommandResult } from './task'
import { raiseTurn } from './turn'

type Values = Partial<Record<TaskField, string | null>>

/**
 * Bloqueia com motivo (`trim`, 1..`Limits.reason`). Mesmo motivo é no-op (Decisão 10). Grava
 * `blocked_*`, toca, e o inverso `unblock` devolve os `blocked_*` anteriores (Decisão 11).
 */
export function blockTask(
  d: DomainDeps,
  actor: Actor,
  i: { id: string; reason: string }
): TaskCommandResult {
  const reason = i.reason.trim()
  if (reason === '') throw domainError('VALIDATION', 'reason_required', { field: 'reason' })
  checkMax('reason', reason, Limits.reason)
  const w = d.tx((emit) => {
    const rec = liveTask(d.db, i.id)
    if (rec.blocked_reason === reason) return { task_id: rec.id, activity_id: null }
    const now = nowIso(d)
    d.db
      .prepare('update task set blocked_reason = ?, blocked_at = ?, touched_at = ? where id = ?')
      .run(reason, now, now, rec.id)
    emit({ entity: 'task', ids: [rec.id], op: 'upsert' })
    const inverse: Inverse = {
      op: 'unblock',
      task_id: rec.id,
      expect: { blocked_reason: reason, blocked_at: now },
      restore: { blocked_reason: rec.blocked_reason, blocked_at: rec.blocked_at }
    }
    const activity_id = recordActivity(d, emit, actor, {
      op: 'task_block',
      task_id: rec.id,
      fields: ['blocked_reason', 'blocked_at'],
      inverse
    })
    return { task_id: rec.id, activity_id }
  })
  return { row: taskRow(d, w.task_id), activity_id: w.activity_id }
}

/**
 * Desbloqueia. Não bloqueada é no-op. Ator IA (`mcp|sync|assistant`) liga `desbloqueada` pela
 * regra de prioridade; o inverso `block` leva `blocked_*` e, se mudaram, `turn_*` (Decisão 11).
 */
export function unblockTask(d: DomainDeps, actor: Actor, i: { id: string }): TaskCommandResult {
  const w = d.tx((emit) => {
    const rec = liveTask(d.db, i.id)
    if (rec.blocked_reason === null) return { task_id: rec.id, activity_id: null }
    const now = nowIso(d)
    const next: Values = { blocked_reason: null, blocked_at: null }
    const before: Values = { blocked_reason: rec.blocked_reason, blocked_at: rec.blocked_at }
    if (actor.kind === 'mcp' || actor.kind === 'sync' || actor.kind === 'assistant') {
      const t = raiseTurn(rec, 'desbloqueada', now)
      if (t.turn_reason !== rec.turn_reason || t.turn_at !== rec.turn_at) {
        Object.assign(next, t)
        before.turn_reason = rec.turn_reason
        before.turn_at = rec.turn_at
      }
    }
    const keys = Object.keys(next) as TaskField[]
    d.db
      .prepare(
        `update task set ${keys.map((k) => `${k} = @${k}`).join(', ')}, touched_at = @now where id = @id`
      )
      .run({ ...next, now, id: rec.id })
    emit({ entity: 'task', ids: [rec.id], op: 'upsert' })
    const activity_id = recordActivity(d, emit, actor, {
      op: 'task_unblock',
      task_id: rec.id,
      fields: keys,
      inverse: { op: 'block', task_id: rec.id, expect: next, restore: before }
    })
    return { task_id: rec.id, activity_id }
  })
  return { row: taskRow(d, w.task_id), activity_id: w.activity_id }
}
