import type { DomainChanged } from '../../shared/ipc/events'
import type { Db } from './open'

export type Tx = <T>(fn: (emit: (c: DomainChanged) => void) => T) => T

/** Transação que só publica os `domain.changed` depois do commit; rollback descarta. */
export function createTx(db: Db, afterCommit: (c: DomainChanged) => void): Tx {
  return (fn) => {
    const pending: DomainChanged[] = []
    const result = db.transaction(() => fn((c) => pending.push(c)))()
    for (const c of pending) afterCommit(c)
    return result
  }
}
