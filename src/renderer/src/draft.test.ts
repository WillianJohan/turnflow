import { expect, it } from 'vitest'
import { draftPayload } from './draft'

it('vira paste entre colchetes, sem o Enter (vai separado)', () =>
  expect(draftPayload('linha 1\nlinha 2\n\n')).toBe('\x1b[200~linha 1\nlinha 2\x1b[201~'))
it('só espaço → nada pra mandar', () => expect(draftPayload('  \n ')).toBeNull())
it('texto não consegue fechar o paste antes da hora', () =>
  expect(draftPayload('a\x1b[201~b')).toBe('\x1b[200~ab\x1b[201~'))
