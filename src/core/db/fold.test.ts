import { describe, expect, it } from 'vitest'
import { fold } from './fold'

describe('fold', () => {
  it('tira acento e caixa', () => {
    expect(fold('Ação')).toBe('acao')
    expect(fold('NÚMERO')).toBe('numero')
  })
  it('string vazia continua vazia', () => {
    expect(fold('')).toBe('')
  })
})
