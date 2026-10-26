import type { Db } from '../../core/db/open'
import { runCommand } from '../../core/domain/commands'
import type { Actor, DomainDeps } from '../../core/domain/context'
import { getTask } from '../../core/domain/rows'
import { listSessions } from '../../core/domain/session'
import { DOMAIN_COPY } from '../../shared/copy/domain'
import * as S from '../../shared/ipc/session'
import { ptySpawn } from '../../shared/ipc/pty'
import type { Vault } from '../../core/key/vault'
import type { PtyGuard } from '../ptyGuard'
import type { SessionHost } from '../sessionHost'
import { IpcError, type Register } from './handle'
import { toIpcDomainError } from './domain'

const USER: Actor = { kind: 'user' }

export function registerSessionIpc(
  handle: Register,
  deps: {
    host: SessionHost
    vault: Vault
    domainFor(db: Db): DomainDeps
    pickFolder(): Promise<string | null>
    guard: PtyGuard
    owner: number
  }
): void {
  const domain = (): DomainDeps => deps.domainFor(deps.vault.db())

  handle(ptySpawn, async (input) => {
    try {
      const out = await deps.host.spawn(input)
      deps.guard.register(input.pty_id, deps.owner)
      return out
    } catch (e) {
      throw toIpcDomainError(e)
    }
  })

  handle(S.sessionList, (input) => {
    try {
      return listSessions(domain(), input.task_id === undefined ? {} : { task_id: input.task_id })
    } catch (e) {
      throw toIpcDomainError(e)
    }
  })

  handle(S.sessionAdopt, (input) => {
    try {
      const d = domain()
      const task = getTask(d, input.task)
      const out = runCommand(
        d,
        USER,
        { op: 'session_adopt', session_id: input.session_id, task_id: task.id },
        {}
      )
      if (out.status === 'needs_confirmation')
        throw new IpcError('PENDING', DOMAIN_COPY.errors.needs_confirmation, {
          reason: 'needs_confirmation',
          op: out.op
        })
      return out.result
    } catch (e) {
      throw toIpcDomainError(e)
    }
  })

  handle(S.sessionOfPty, ({ pty_id }, e) => ({
    session_id: deps.guard.canWrite(pty_id, e.sender.id) ? deps.host.sessionOf(pty_id) : null
  }))

  handle(S.sessionPickWorkdir, () => deps.pickFolder())
}
