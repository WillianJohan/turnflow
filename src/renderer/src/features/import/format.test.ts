import { expect, it } from 'vitest'
import { IMPORT_COPY } from '../../../../shared/copy/import'
import { reasonText, sizeText } from './format'

const COPY = IMPORT_COPY.screen

it('too_long de cada campo que o plano emite vira texto, nunca o código', () => {
  for (const f of [
    'title',
    'description',
    'checkpoint',
    'blocked_reason',
    'workdir',
    'project'
  ] as const)
    expect(reasonText(`too_long:${f}`)).toBe(COPY.reasons.tooLong(COPY.tooLongFields[f]))
})

it('motivo desconhecido cai no genérico', () => {
  for (const r of ['too_long:toString', 'too_long:', 'weird', '', null, undefined])
    expect(reasonText(r)).toBe(COPY.reasons.unknown)
})

it('tamanho com as unidades da copy', () => {
  expect(sizeText(10)).toBe(COPY.size.b(10))
  expect(sizeText(2048)).toBe(COPY.size.kb('2.0'))
  expect(sizeText(3 * 1024 * 1024)).toBe(COPY.size.mb('3.0'))
})
