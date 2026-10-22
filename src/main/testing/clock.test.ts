import { describe, expect, it } from 'vitest'
import { testNow } from './clock'

describe('testNow', () => {
  it('ISO válido em TURNFLOW_TEST_NOW vira relógio fixo', () => {
    const iso = '2026-01-02T03:04:05.000Z'
    const now = testNow({ TURNFLOW_TEST_NOW: iso })!
    expect(now().toISOString()).toBe(iso)
    expect(now().toISOString()).toBe(now().toISOString())
  })

  it('inválido ou ausente → null', () => {
    expect(testNow({ TURNFLOW_TEST_NOW: 'ontem' })).toBeNull()
    expect(testNow({})).toBeNull()
  })
})
