import type { Db } from './open'
import type { Tx } from './tx'

/**
 * Apaga a task de vez (LGPD): a cascata leva os checkpoints e os triggers limpam o FTS. Emite o
 * `domain.changed` pelo `tx` (sai depois do commit) e compacta o arquivo. `false` se não existia.
 */
export function purgeTask(db: Db, taskId: string, tx: Tx): boolean {
  const removed = tx((emit) => {
    const n = db.prepare('delete from task where id = ?').run(taskId).changes
    if (n > 0) emit({ entity: 'task', ids: [taskId], op: 'delete' })
    return n > 0
  })
  if (removed) compact(db)
  return removed
}

/**
 * Tira do disco o que o `secure_delete` não alcança: as páginas antigas no `-wal` e as páginas
 * livres do arquivo principal. Os temporários do `VACUUM` ficam em memória (`temp_store`).
 * @throws Error se chamado dentro de uma transação aberta (o `VACUUM` não roda dentro de uma);
 *   nada é checkpointado nesse caso.
 */
export function compact(db: Db): void {
  if (db.inTransaction) throw new Error('compact: não pode rodar dentro de uma transação')
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.exec('VACUUM')
  db.pragma('wal_checkpoint(TRUNCATE)')
}
