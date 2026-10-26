import { IMPORT_COPY } from '../../shared/copy/import'
import { DomainError } from '../domain/errors'

export type ImportErrorReason = keyof typeof IMPORT_COPY.errors

/** Erro do import, com `details.reason` e a mensagem do `IMPORT_COPY.errors`. */
export function importError(
  code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT',
  reason: ImportErrorReason,
  details: Record<string, unknown> = {}
): DomainError {
  return new DomainError(code, IMPORT_COPY.errors[reason], { reason, ...details })
}
