import { describe, expect, it, vi } from 'vitest'
import { coalesce } from './coalesce'

describe('coalesce', () => {
  it('rajada vira uma rodada; pedido durante a rodada vale mais uma, nunca em paralelo', async () => {
    vi.useFakeTimers()
    let active = 0
    let max = 0
    let runs = 0
    let release: () => void = () => undefined
    const c = coalesce(async () => {
      runs++
      active++
      max = Math.max(max, active)
      await new Promise<void>((r) => (release = r))
      active--
    }, 50)
    for (let i = 0; i < 10; i++) c.trigger()
    await vi.advanceTimersByTimeAsync(60)
    expect(runs).toBe(1)
    c.trigger()
    c.trigger()
    await vi.advanceTimersByTimeAsync(60)
    expect(runs).toBe(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toBe(2)
    release()
    await vi.advanceTimersByTimeAsync(100)
    expect(runs).toBe(2)
    expect(max).toBe(1)
    vi.useRealTimers()
  })
})
