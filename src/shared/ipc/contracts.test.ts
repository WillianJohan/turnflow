import { describe, expect, it } from 'vitest'
import { ZodType } from 'zod'
import { CHANNELS } from './registry'
import { MANIFEST } from './manifest'

describe('contratos IPC', () => {
  const all = Object.entries(CHANNELS)
  it('cobre os 70 canais', () => {
    expect(all).toHaveLength(70)
  })
  it('todo canal tem input e output zod', () => {
    for (const [, ch] of all) {
      expect(ch.input, ch.name).toBeInstanceOf(ZodType)
      expect(ch.output, ch.name).toBeInstanceOf(ZodType)
    }
  })
  it('nomes únicos', () => {
    const names = all.map(([, c]) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
  it('manifesto do preload espelha o registro (nome e kind)', () => {
    const derived = Object.fromEntries(all.map(([k, c]) => [k, [c.name, c.kind]]))
    expect(MANIFEST).toEqual(derived)
  })
  it('send nunca tem output além de void', () => {
    for (const [, ch] of all)
      if (ch.kind === 'send') expect(ch.output.safeParse(undefined).success, ch.name).toBe(true)
  })
})
