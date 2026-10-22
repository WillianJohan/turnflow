import { DOMAIN_COPY, type DomainErrorReason, type NotFoundEntity } from '../../shared/copy/domain'

export type DomainErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'PENDING'

/**
 * Erro de regra do domínio, com o código do IPC (Decisão 25). `details` leva ids e nomes de etapa,
 * nunca texto de task, e a mensagem nunca leva ULID de task (Decisão 26).
 */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

/** Erro com `details.reason` e a mensagem do `DOMAIN_COPY`. */
export function domainError(
  code: DomainErrorCode,
  reason: DomainErrorReason,
  details: Record<string, unknown> = {}
): DomainError {
  return new DomainError(code, DOMAIN_COPY.errors[reason], { reason, ...details })
}

export function notFound(entity: NotFoundEntity, id: string | null): DomainError {
  return new DomainError('NOT_FOUND', DOMAIN_COPY.notFound(entity), {
    reason: 'not_found',
    entity,
    id
  })
}

/** `VALIDATION too_long` se o texto passa do teto (`Limits`); devolve o próprio valor. */
export function checkMax<T extends string | null>(field: string, value: T, max: number): T {
  if (value !== null && value.length > max)
    throw domainError('VALIDATION', 'too_long', { field, max })
  return value
}
