import { describe, expect, it } from 'vitest'
import { chunks } from './chunk'
import { MAX_PTY_DATA } from '../../shared/ipc/limits'

describe('chunks (paste grande pro pty)', () => {
  it('2,5 MB vira 3 pedaços, em ordem, que somados dão o original', () => {
    const s = 'a'.repeat(MAX_PTY_DATA) + 'b'.repeat(MAX_PTY_DATA) + 'c'.repeat(MAX_PTY_DATA / 2)
    const out = chunks(s)
    expect(out).toHaveLength(3)
    expect(out.join('')).toBe(s)
    expect(out.map((c) => c[0])).toEqual(['a', 'b', 'c'])
    expect(out.every((c) => c.length <= MAX_PTY_DATA)).toBe(true)
  })
  it('texto pequeno é um pedaço só', () => {
    expect(chunks('ls\r')).toEqual(['ls\r'])
  })
  it('vazio não gera escrita', () => {
    expect(chunks('')).toEqual([])
  })
  it('não parte um par surrogate (emoji) no meio', () => {
    const s = 'x'.repeat(9) + '😀' + 'y'
    const out = chunks(s, 10)
    expect(out.join('')).toBe(s)
    for (const c of out) expect(/[\uD800-\uDBFF]$/.test(c)).toBe(false)
    expect(out.every((c) => c.length <= 10)).toBe(true)
  })
})
