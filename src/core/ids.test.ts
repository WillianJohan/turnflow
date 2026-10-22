import { describe, expect, it } from 'vitest'
import { newId } from './ids'

describe('newId', () => {
  it('1000 ids seguidos: únicos, 26 chars e já em ordem crescente', () => {
    const ids = Array.from({ length: 1000 }, () => newId())
    expect(new Set(ids).size).toBe(1000)
    expect(ids.every((i) => i.length === 26)).toBe(true)
    expect(ids).toEqual([...ids].sort())
  })
})
