import { describe, expect, it, vi } from 'vitest'
import { orThrow, unwrap } from './ipc'

describe('unwrap', () => {
  it('ok devolve o dado', async () => {
    expect(await unwrap(Promise.resolve({ ok: true as const, data: 3 }))).toBe(3)
  })
  it('erro vira undefined e é reportado', async () => {
    const report = vi.fn()
    const r = await unwrap(
      Promise.resolve({ ok: false as const, error: { code: 'INTERNAL' as const, message: 'x' } }),
      report
    )
    expect(r).toBeUndefined()
    expect(report).toHaveBeenCalledWith({ code: 'INTERNAL', message: 'x' })
  })
})

describe('orThrow', () => {
  it('erro rejeita com a mensagem do main', async () => {
    await expect(
      orThrow(
        Promise.resolve({
          ok: false as const,
          error: { code: 'CONFLICT' as const, message: 'já aberta' }
        })
      )
    ).rejects.toThrow('já aberta')
  })
  it('ok devolve o dado', async () => {
    expect(await orThrow(Promise.resolve({ ok: true as const, data: 'a' }))).toBe('a')
  })
})
