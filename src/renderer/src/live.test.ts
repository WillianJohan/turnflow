import { expect, it } from 'vitest'
import { termsToDispose } from './live'

it('descarta xterm de processo morto sem aba, mas nunca o do modal Atualizar', () => {
  expect(termsToDispose({ 'WF-1': 0, 'WF-2': 1, __update__: 0 }, new Set(['WF-2']))).toEqual([
    'WF-1'
  ])
})
