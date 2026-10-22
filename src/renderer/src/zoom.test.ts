import { expect, it } from 'vitest'
import { zoomFont } from './zoom'

it('scroll pra cima aumenta, pra baixo diminui (1px por passo)', () => {
  expect(zoomFont(13, -100)).toBe(14)
  expect(zoomFont(13, 100)).toBe(12)
})
it('limita entre 8 e 32', () => {
  expect(zoomFont(8, 100)).toBe(8)
  expect(zoomFont(32, -100)).toBe(32)
})
it('scroll sem deslocamento não muda', () => expect(zoomFont(13, 0)).toBe(13))
