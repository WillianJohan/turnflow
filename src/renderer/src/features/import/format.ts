import { IMPORT_COPY } from '../../../../shared/copy/import'

const COPY = IMPORT_COPY.screen
type TooLongField = keyof typeof COPY.tooLongFields

/** Motivo de task inválida em texto: `too_long:<campo>` vem do plano; o resto vira o genérico. */
export function reasonText(reason: string | null | undefined): string {
  const m = /^too_long:(.+)$/.exec(reason ?? '')
  if (m && Object.hasOwn(COPY.tooLongFields, m[1]!))
    return COPY.reasons.tooLong(COPY.tooLongFields[m[1] as TooLongField])
  return COPY.reasons.unknown
}

export function sizeText(n: number): string {
  if (n < 1024) return COPY.size.b(n)
  if (n < 1024 * 1024) return COPY.size.kb((n / 1024).toFixed(1))
  return COPY.size.mb((n / 1024 / 1024).toFixed(1))
}
