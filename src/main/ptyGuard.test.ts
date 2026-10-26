import { describe, expect, it } from 'vitest'
import { createPtyGuard } from './ptyGuard'

describe('createPtyGuard', () => {
  it('só o dono do pty pode escrever', () => {
    const g = createPtyGuard()
    g.register('t1', 1)
    expect(g.canWrite('t1', 1)).toBe(true)
    expect(g.canWrite('t1', 2)).toBe(false)
  })
  it('id inexistente nunca escreve', () => {
    expect(createPtyGuard().canWrite('nada', 1)).toBe(false)
  })
  it('depois de release ninguém escreve', () => {
    const g = createPtyGuard()
    g.register('t1', 1)
    g.release('t1')
    expect(g.canWrite('t1', 1)).toBe(false)
  })
})
