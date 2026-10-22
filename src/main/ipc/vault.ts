import { BRAND } from '../../shared/brand'
import { VAULT_COPY } from '../../shared/copy/vault'
import type { Channel } from '../../shared/ipc/define'
import type { ErrCode } from '../../shared/ipc/result'
import * as V from '../../shared/ipc/vault'
import type { Boot } from '../../shared/ipc/vault'
import { VaultError, type VaultErrorCode } from '../../core/key/errors'
import { recoveryFileText } from '../../core/key/recovery'
import type { Vault } from '../../core/key/vault'
import { IpcError, type Handler } from './handle'

/**
 * Diálogos nativos que os canais do vault usam. `save` grava `text` (0600) e devolve o caminho;
 * `open` escolhe um backup (`*.db`). Os dois devolvem null se cancelado.
 */
export type VaultDialogs = {
  save(defaultName: string, text: string): Promise<string | null>
  open(): Promise<string | null>
}

type Register = <C extends Channel>(ch: C, fn: Handler<C>) => void

// Só o código muda; a mensagem é a do VaultError (VAULT_COPY.errors), que nunca leva segredo.
const IPC_CODE: Partial<Record<VaultErrorCode, ErrCode>> = {
  WRONG_PASSWORD: 'LOCKED',
  KEYRING_UNAVAILABLE: 'LOCKED',
  LOCKED: 'LOCKED',
  PASSWORD_REQUIRED: 'VALIDATION',
  PASSWORD_TOO_SHORT: 'VALIDATION',
  WORDS_COUNT: 'VALIDATION',
  WORDS_UNKNOWN: 'VALIDATION',
  WORDS_CHECKSUM: 'VALIDATION',
  WRONG_KEY: 'VALIDATION',
  BACKUP_NEWER: 'VALIDATION',
  NOT_A_BACKUP: 'VALIDATION',
  BAD_STATE: 'CONFLICT'
}

export function toIpcError(e: unknown): IpcError {
  if (e instanceof IpcError) return e
  if (e instanceof VaultError) {
    const index = e.details?.index
    return new IpcError(
      IPC_CODE[e.code] ?? 'INTERNAL',
      e.message,
      e.code === 'WORDS_UNKNOWN' && index !== undefined ? { index } : undefined
    )
  }
  // a mensagem crua (SQLite, caminho...) só vai pro log, nunca pro renderer
  console.error('[ipc] erro inesperado:', e instanceof Error ? e.message : String(e))
  return new IpcError('INTERNAL', VAULT_COPY.errors.INTERNAL)
}

export function bootOf(vault: Vault, version: string): Boot {
  return {
    state: vault.state(),
    backend: vault.backend(),
    lock: vault.lockReason(),
    failure: vault.failure(),
    version
  }
}

/** Callback para o `onChange` do `createVault`: transmite o `Boot` atual. O getter evita o ciclo de construção. */
export function wireVaultEvents(o: {
  vault: () => Vault
  version: string
  broadcast: (b: Boot) => void
}): () => void {
  return () => o.broadcast(bootOf(o.vault(), o.version))
}

export function registerVaultIpc(
  h: Register,
  deps: { vault: Vault; version: string; dialogs: VaultDialogs; now?: () => Date }
): void {
  const { vault, version, dialogs } = deps
  const now = deps.now ?? ((): Date => new Date())
  const boot = (): Boot => bootOf(vault, version)
  const guarded = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      throw toIpcError(e)
    }
  }

  h(V.bootGet, boot)
  h(V.firstRunBegin, ({ password }) => guarded(() => vault.beginFirstRun(password)))
  h(V.firstRunSaveWords, () =>
    guarded(async () => {
      const words = vault.pendingWords()
      if (!words) throw new IpcError('CONFLICT', VAULT_COPY.errors.BAD_STATE)
      const path = await dialogs.save(
        `${BRAND.id}-chave-de-recuperacao.txt`,
        recoveryFileText(words, now())
      )
      return path === null ? null : { path }
    })
  )
  // `saved: true` é exigido pelo contrato: o zod barra antes de chegar aqui
  h(V.firstRunCommit, () => guarded(() => vault.commitFirstRun()).then(boot))
  h(V.firstRunPickBackup, () =>
    guarded(async () => {
      const path = await dialogs.open()
      return path === null ? null : { path }
    })
  )
  h(V.firstRunRestore, ({ backupPath, words, password }) =>
    guarded(() => vault.restore(backupPath, words, password)).then(boot)
  )
  h(V.vaultUnlock, ({ password }) => guarded(() => vault.unlockWithPassword(password)).then(boot))
  h(V.vaultRecover, ({ words, newPassword }) =>
    guarded(() => vault.recover(words, newPassword)).then(boot)
  )
}
