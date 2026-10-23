import { expect, it } from 'vitest'
import { termsToDispose } from './live'

it('descarta xterm de processo morto sem aba, mas nunca o do modal Atualizar', () => {
  expect(termsToDispose({ 'T-1': 0, 'T-2': 1, __update__: 0 }, new Set(['T-2']))).toEqual(['T-1'])
})
