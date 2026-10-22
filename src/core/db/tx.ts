import type { DomainChanged } from '../../shared/ipc/events'
import type { Db } from './open'

export type Tx = <T>(fn: (emit: (c: DomainChanged) => void) => T) => T

/**
 * Transação que só publica os `domain.changed` depois do commit; rollback descarta.
 * `fn` é síncrona e a tx não aninha (não chame `tx` de dentro de `fn`).
 * Um listener que lança não afeta a escrita já commitada nem os demais eventos: o erro vai para `onListenerError`.
 */
export function createTx(
  db: Db,
  afterCommit: (c: DomainChanged) => void,
  onListenerError: (e: unknown) => void = (e) => console.error('domain.changed listener falhou', e)
): Tx {
  return (fn) => {
    // aninhar viraria savepoint e soltaria o afterCommit antes do commit de fora (Decisão 27)
    if (db.inTransaction) throw new Error('tx não aninha: já existe uma transação aberta')
    const pending: DomainChanged[] = []
    const result = db.transaction(() => {
      const r = fn((c) => pending.push(c))
      if (typeof (r as { then?: unknown } | null)?.then === 'function')
        throw new Error(
          'tx: fn precisa ser síncrona (a transação já fechou quando a Promise resolver)'
        )
      return r
    })()
    for (const c of pending) {
      try {
        afterCommit(c)
      } catch (e) {
        onListenerError(e)
      }
    }
    return result
  }
}
