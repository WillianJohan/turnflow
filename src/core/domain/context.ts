import type { DomainChanged } from '../../shared/ipc/events'
import type { Db } from '../db/open'
import { createTx, type Tx } from '../db/tx'
import { newId } from '../ids'

/** Quem fez a escrita. `client_id` (só MCP) vai para `activity.client_id`. */
export type Actor =
  | { kind: 'user' }
  | { kind: 'mcp'; client_id: string }
  | { kind: 'sync' }
  | { kind: 'assistant' }
  | { kind: 'import' }

/** Porta para o vínculo remoto (E9 liga o `task_remote`); até lá nenhuma task está vinculada. */
export type RemotePort = { isLinked(db: Db, taskId: string): boolean }

/**
 * Dependências de toda função do domínio. Regra da transação (Decisão 27): cada função pública
 * abre `tx` uma vez só; o miolo `xxxIn(d, emit, …)` roda sem `tx` e é o que outra operação chama
 * por dentro, porque o `createTx` não aninha.
 */
export type DomainDeps = {
  db: Db
  tx: Tx
  now: () => Date
  newId: () => string
  defaultWorkdir: () => string | null
  remote: RemotePort
}

export function createDomain(o: {
  db: Db
  afterCommit: (c: DomainChanged) => void
  now?: () => Date
  newId?: () => string
  defaultWorkdir?: () => string | null
  remote?: RemotePort
}): DomainDeps {
  return {
    db: o.db,
    tx: createTx(o.db, o.afterCommit),
    now: o.now ?? (() => new Date()),
    newId: o.newId ?? newId,
    defaultWorkdir: o.defaultWorkdir ?? (() => null),
    remote: o.remote ?? { isLinked: () => false }
  }
}

export type Emit = (c: DomainChanged) => void

/** `now` injetado em ISO-8601 UTC. */
export const nowIso = (d: DomainDeps): string => d.now().toISOString()
