import { VAULT_COPY } from '../../shared/copy/vault'
import { DbOpenError } from './errors'
import type { Db } from './open'

export type Migration = { version: number; name: string; up: (db: Db) => void }

/** Maior versão da lista; lista vazia é 0. */
export const latestVersion = (list: Migration[]): number =>
  list.reduce((m, x) => Math.max(m, x.version), 0)

/**
 * Aplica as migrations pendentes, todas numa transação só (DDL do SQLite é transacional):
 * se uma falhar, nada muda. `beforeApply` roda fora da transação, só quando há pendente.
 */
export function migrate(
  db: Db,
  list: Migration[],
  beforeApply?: (from: number, to: number) => void
): { from: number; to: number } {
  const from = db.pragma('user_version', { simple: true }) as number
  const latest = latestVersion(list)
  if (from > latest)
    throw new DbOpenError('NEWER_SCHEMA', VAULT_COPY.newerSchema(from, latest), { version: from })
  const pending = list.filter((m) => m.version > from).sort((a, b) => a.version - b.version)
  if (pending.length === 0) return { from, to: from }
  beforeApply?.(from, latest)
  let current: Migration | undefined
  try {
    db.transaction(() => {
      for (const m of pending) {
        current = m
        m.up(db)
        db.pragma(`user_version = ${m.version}`)
      }
    })()
  } catch (e) {
    if (!current) throw e
    const msg = e instanceof Error ? e.message : String(e)
    throw new DbOpenError(
      'MIGRATION_FAILED',
      VAULT_COPY.migrationFailed(current.version, current.name, msg),
      { version: current.version },
      { cause: e }
    )
  }
  return { from, to: latest }
}
