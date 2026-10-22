import { describe, expect, it } from 'vitest'
import { raiseTurn } from './turn'

const H09 = '2026-10-22T09:00:00.000Z'
const H12 = '2026-10-22T12:00:00.000Z'

describe('raiseTurn', () => {
  it('sem motivo liga com o agora', () => {
    expect(raiseTurn({ turn_reason: null, turn_at: null }, 'atribuida', H12)).toEqual({
      turn_reason: 'atribuida',
      turn_at: H12
    })
  })

  it('atribuida não rebaixa voltou e o turn_at fica o mais antigo', () => {
    expect(raiseTurn({ turn_reason: 'voltou', turn_at: H09 }, 'atribuida', H12)).toEqual({
      turn_reason: 'voltou',
      turn_at: H09
    })
  })

  it('voltou sobe atribuida mantendo o turn_at antigo', () => {
    expect(raiseTurn({ turn_reason: 'atribuida', turn_at: H09 }, 'voltou', H12)).toEqual({
      turn_reason: 'voltou',
      turn_at: H09
    })
  })

  it('desbloqueada fica entre os dois e o mesmo motivo não mexe', () => {
    expect(raiseTurn({ turn_reason: 'atribuida', turn_at: H09 }, 'desbloqueada', H12)).toEqual({
      turn_reason: 'desbloqueada',
      turn_at: H09
    })
    expect(
      raiseTurn({ turn_reason: 'voltou', turn_at: H09 }, 'desbloqueada', H12).turn_reason
    ).toBe('voltou')
    expect(raiseTurn({ turn_reason: 'voltou', turn_at: H09 }, 'voltou', H12).turn_at).toBe(H09)
  })
})
