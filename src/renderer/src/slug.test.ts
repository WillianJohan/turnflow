import { expect, it } from 'vitest'
import { slug } from './slug'

it('nome do tema vira nome de arquivo', () => {
  expect(slug('Laranja Noturno Ção!')).toBe('laranja-noturno-cao')
  expect(slug('  ')).toBe('')
})
