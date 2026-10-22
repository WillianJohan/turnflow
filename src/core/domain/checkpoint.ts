import { createHash } from 'node:crypto'
import { Limits } from '../../shared/contracts'
import { recordActivity } from './activity'
import { nowIso, type Actor, type DomainDeps } from './context'
import { checkMax, domainError } from './errors'
import { liveTask, taskRow } from './rows'
import type { TaskCommandResult } from './task'

type Source = 'user' | 'ai' | 'sync' | 'import'

const sourceOf = (actor: Actor): Source =>
  actor.kind === 'user'
    ? 'user'
    : actor.kind === 'mcp' || actor.kind === 'assistant'
      ? 'ai'
      : actor.kind

/**
 * Registra onde parou. Texto `trim` 1..`Limits.checkpoint`; `text_hash` = sha256 do texto em NFC
 * (para o dedup do E9). Limpa a vez e toca a task. A Atividade não tem inverso.
 */
export function addCheckpoint(
  d: DomainDeps,
  actor: Actor,
  i: { task_id: string; text: string }
): TaskCommandResult & { checkpoint_id: string } {
  const text = i.text.trim()
  if (text === '') throw domainError('VALIDATION', 'text_required', { field: 'text' })
  checkMax('text', text, Limits.checkpoint)
  const w = d.tx((emit) => {
    const rec = liveTask(d.db, i.task_id)
    const now = nowIso(d)
    const checkpoint_id = d.newId()
    const hash = createHash('sha256').update(text.normalize('NFC')).digest('hex')
    d.db
      .prepare(
        'insert into checkpoint(id, task_id, at, text, source, text_hash) values (?, ?, ?, ?, ?, ?)'
      )
      .run(checkpoint_id, rec.id, now, text, sourceOf(actor), hash)
    d.db
      .prepare('update task set turn_reason = null, turn_at = null, touched_at = ? where id = ?')
      .run(now, rec.id)
    emit({ entity: 'task', ids: [rec.id], op: 'upsert' })
    const cleared = rec.turn_reason !== null || rec.turn_at !== null
    const activity_id = recordActivity(d, emit, actor, {
      op: 'checkpoint_add',
      task_id: rec.id,
      fields: cleared ? ['turn_reason', 'turn_at'] : [],
      inverse: null,
      data: { checkpoint_id }
    })
    return { task_id: rec.id, activity_id, checkpoint_id }
  })
  return { row: taskRow(d, w.task_id), activity_id: w.activity_id, checkpoint_id: w.checkpoint_id }
}
