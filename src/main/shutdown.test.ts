import { describe, expect, it, vi } from 'vitest'
import { runShutdown, shutdownPlan } from './shutdown'

describe('runShutdown', () => {
  it('roda os passos em ordem esperando cada um', async () => {
    const order: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const done = runShutdown(
      [
        {
          name: 'a',
          run: async () => {
            order.push('a')
            await gate
            order.push('a-done')
          }
        },
        { name: 'b', run: () => void order.push('b') }
      ],
      { totalMs: 5000, log: () => undefined }
    )
    await Promise.resolve()
    expect(order).toEqual(['a'])
    release()
    await done
    expect(order).toEqual(['a', 'a-done', 'b'])
  })

  it('passo que lança não impede o seguinte e vai pro log', async () => {
    const order: string[] = []
    const log = vi.fn()
    await runShutdown(
      [
        {
          name: 'bad',
          run: () => {
            throw new Error('boom')
          }
        },
        { name: 'next', run: () => void order.push('next') }
      ],
      { totalMs: 1000, log }
    )
    expect(order).toEqual(['next'])
    expect(log.mock.calls[0]?.[0]).toContain('boom')
  })

  it('estoura o teto e resolve', async () => {
    vi.useFakeTimers()
    try {
      let finished = false
      const p = runShutdown([{ name: 'hang', run: () => new Promise(() => undefined) }], {
        totalMs: 5000,
        log: () => undefined
      }).then(() => {
        finished = true
      })
      await vi.advanceTimersByTimeAsync(5000)
      await p
      expect(finished).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('shutdownPlan', () => {
  it('na ordem pty → sessions → socket → hooks → changeBus → vault', async () => {
    const calls: string[] = []
    const steps = shutdownPlan({
      host: { killAllAndWait: async () => void calls.push('pty') } as never,
      domain: () => null,
      socket: { close: async () => void calls.push('socket') },
      hooks: { close: async () => void calls.push('hooks') },
      changeBus: { dispose: () => void calls.push('changeBus') },
      vault: { close: () => void calls.push('vault') }
    })
    expect(steps.map((s) => s.name)).toEqual([
      'pty',
      'sessions',
      'socket',
      'hooks',
      'changeBus',
      'vault'
    ])
    for (const step of steps) await step.run()
    expect(calls).toEqual(['pty', 'socket', 'hooks', 'changeBus', 'vault'])
  })
})
