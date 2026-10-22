import { VAULT_COPY } from '../../shared/copy/vault'

export type VaultErrorCode =
  | 'PASSWORD_REQUIRED'
  | 'PASSWORD_TOO_SHORT'
  | 'WRONG_PASSWORD'
  | 'WORDS_COUNT'
  | 'WORDS_UNKNOWN'
  | 'WORDS_CHECKSUM'
  | 'WRONG_KEY'
  | 'KEYRING_UNAVAILABLE'
  | 'KEYFILE_CORRUPT'
  | 'NOT_A_BACKUP'
  | 'BACKUP_NEWER'
  | 'NEWER_SCHEMA'
  | 'MIGRATION_FAILED'
  | 'OPEN_FAILED'
  | 'LOCKED'
  | 'BAD_STATE'

export type VaultErrorDetails = { index?: number; version?: number; message?: string }

// Só estes levam a mensagem de origem (erro de abertura/migração ou de estado), que nunca tem segredo.
const PASS_THROUGH: ReadonlySet<VaultErrorCode> = new Set([
  'MIGRATION_FAILED',
  'OPEN_FAILED',
  'BAD_STATE'
])

function messageFor(code: VaultErrorCode, details?: VaultErrorDetails): string {
  if (PASS_THROUGH.has(code) && details?.message) return details.message
  if (code === 'WORDS_UNKNOWN' && details?.index !== undefined)
    return VAULT_COPY.wordUnknown(details.index + 1)
  return VAULT_COPY.errors[code]
}

/** Erro do vault/chave. A mensagem vem de `VAULT_COPY`, nunca de dado do usuário. */
export class VaultError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    readonly details?: VaultErrorDetails
  ) {
    super(messageFor(code, details))
    this.name = 'VaultError'
  }
}
