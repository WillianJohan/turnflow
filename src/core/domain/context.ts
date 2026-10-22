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

/** `touched_at` só anda com escrita do usuário ou da IA; o pull do sync não conta (spec §4). */
export const touchExpr = (actor: Actor, now: string): string =>
  actor.kind === 'sync' ? 'touched_at' : now

/** Contadores derivados: a task mudou de situação, então o projeto e o fluxo dela releem. */
export function emitCounters(
  emit: Emit,
  t: { project_id: string | null; flow_id: string },
  ...more: { flow_id: string }[]
): void {
  if (t.project_id) emit({ entity: 'project', ids: [t.project_id], op: 'upsert' })
  const flows = new Set([t.flow_id, ...more.map((m) => m.flow_id)])
  emit({ entity: 'flow', ids: [...flows], op: 'upsert' })
}
