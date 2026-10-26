import { expect, it } from 'vitest'
import { dragSizes } from './resize'

it('arrastar a divisória move largura de um painel pro vizinho, mantendo a soma', () => {
  // dois painéis de 500px com peso 1 cada; arrasta 100px pra direita
  const [a, b] = dragSizes(1, 1, 500, 500, 100)
  expect(a + b).toBeCloseTo(2)
  expect(a / b).toBeCloseTo(600 / 400)
})
it('nenhum painel fica menor que 300px', () => {
  const [a, b] = dragSizes(1, 1, 500, 500, 450)
  expect(b / (a + b)).toBeCloseTo(300 / 1000)
  const [c] = dragSizes(1, 1, 500, 500, -450)
  expect(c / 2).toBeCloseTo(300 / 1000)
})
it('painéis menores que dois mínimos não geram peso zero ou negativo', () => {
  for (const [wa, wb] of [
    [100, 100],
    [0, 0]
  ]) {
    const [a, b] = dragSizes(1, 1, wa, wb, 10)
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(0)
    expect(a + b).toBeCloseTo(2)
  }
})
