import type { z } from 'zod'
import type { Db } from '../../core/db/open'
import { runCommand, type Command, type CommandResults } from '../../core/domain/commands'
import { createDomain, type Actor, type DomainDeps } from '../../core/domain/context'
import { DomainError } from '../../core/domain/errors'
import { listFlows, listTypes } from '../../core/domain/flow'
import { getProject, listProjects } from '../../core/domain/project'
import { attentionCounts, getTask, listTasks } from '../../core/domain/rows'
import { listActivity } from '../../core/domain/undo'
import type { Vault } from '../../core/key/vault'
import { DOMAIN_COPY } from '../../shared/copy/domain'
import type { Channel } from '../../shared/ipc/define'
import * as D from '../../shared/ipc/domain'
import type { DomainChanged } from '../../shared/ipc/events'
import { IpcError, type Register } from './handle'
import { toIpcError } from './vault'

export type DomainIpcDeps = { vault: Vault; domainFor: (db: Db) => DomainDeps }

/**
 * Um `DomainDeps` por instância de `Db`: trocar o banco (wipe/restore) cria outro, e o velho some
 * com ele. O `registerIpc` cria um só e entrega o mesmo ao domínio e ao import (Decisão 33).
 */
export function domainCache(deps: {
  now: () => Date
  defaultWorkdir: () => string | null
  afterCommit: (c: DomainChanged) => void
}): (db: Db) => DomainDeps {
  const domains = new WeakMap<Db, DomainDeps>()
  return (db) => {
    let d = domains.get(db)
    if (!d) {
      d = createDomain({
        db,
        afterCommit: deps.afterCommit,
        now: deps.now,
        defaultWorkdir: deps.defaultWorkdir
      })
      domains.set(db, d)
    }
    return d
  }
}

const USER: Actor = { kind: 'user' }

/**
 * `DomainError` vira `IpcError` com o mesmo código e `details` (Decisão 25); `VaultError`
 * (`LOCKED` fora de `ready`) vira o código do vault. O resto passa intacto e o `handle` o
 * transforma em `INTERNAL` genérico, com a mensagem crua só no log local.
 */
export function toIpcDomainError(e: unknown): unknown {
  if (e instanceof DomainError) return new IpcError(e.code, e.message, e.details)
  return toIpcError(e)
}

/**
 * Toda escrita da UI entra pelo portão (Decisão 8). `confirmed` só vem dos deletes, cujo schema
 * exige `confirmed: true`; `needs_confirmation` aqui seria schema e portão divergindo.
 */
function run<C extends Command>(d: DomainDeps, cmd: C, confirmed?: true): CommandResults[C['op']] {
  const out = runCommand(d, USER, cmd, { confirmed })
  if (out.status === 'needs_confirmation')
    throw new IpcError('PENDING', DOMAIN_COPY.errors.needs_confirmation, {
      reason: 'needs_confirmation',
      op: out.op
    })
  return out.result
}

export function registerDomainIpc(h: Register, deps: DomainIpcDeps): void {
  const { domainFor } = deps
  const on = <C extends Channel>(
    ch: C,
    fn: (d: DomainDeps, input: z.output<C['input']>) => z.input<C['output']>
  ): void =>
    h(ch, (input) => {
      try {
        // vault.db() lança LOCKED fora de `ready`
        return fn(domainFor(deps.vault.db()), input)
      } catch (e) {
        throw toIpcDomainError(e)
      }
    })

  on(D.taskList, (d, { scope }) => listTasks(d, scope))
  on(D.taskGet, (d, { id }) => getTask(d, id))
  on(D.attentionCounts, (d) => attentionCounts(d))
  on(D.flowList, (d) => listFlows(d))
  on(D.taskTypeList, (d) => listTypes(d))
  on(D.projectList, (d) => listProjects(d))
  on(D.projectGet, (d, { id }) => getProject(d, id))
  on(D.activityList, (d, q) => listActivity(d, q))

  on(D.taskCreate, (d, input) => run(d, { op: 'task_create', input }))
  on(D.taskUpdate, (d, { id, patch }) => run(d, { op: 'task_update', id, patch }))
  on(D.taskSetWorkdir, (d, { id, workdir }) =>
    run(d, { op: 'task_update', id, patch: { workdir } })
  )
  on(D.taskSetStage, (d, { id, stage_id }) => run(d, { op: 'task_set_stage', id, stage_id }))
  on(D.taskClose, (d, { id }) => run(d, { op: 'task_close', id }))
  on(D.taskBlock, (d, { id, reason }) => run(d, { op: 'task_block', id, reason }))
  on(D.taskUnblock, (d, { id }) => run(d, { op: 'task_unblock', id }))
  on(D.taskDismiss, (d, { id }) => run(d, { op: 'task_dismiss', id }))
  on(D.taskDelete, (d, { id, confirmed }) => run(d, { op: 'task_delete', id }, confirmed))
  on(D.taskMove, (d, input) => run(d, { op: 'task_move', ...input }))
  on(D.taskSetFlow, (d, { id, flow_id, mapping }) =>
    run(d, { op: 'task_set_flow', id, flow_id, mapping })
  )
  on(D.checkpointAdd, (d, { task_id, text }) => run(d, { op: 'checkpoint_add', task_id, text }))

  on(D.projectCreate, (d, input) => run(d, { op: 'project_create', input }))
  on(D.projectUpdate, (d, { id, patch }) => run(d, { op: 'project_update', id, patch }))
  on(D.projectDelete, (d, { id, confirmed }) => run(d, { op: 'project_delete', id }, confirmed))
  on(D.flowSaveStage, (d, input) => run(d, { op: 'flow_save_stage', input }))
  on(D.flowDeleteStage, (d, { id, to_stage_id }) =>
    run(d, { op: 'flow_delete_stage', id, to_stage_id })
  )
  on(D.activityUndo, (d, { activity_id }) => run(d, { op: 'activity_undo', activity_id }))
}
