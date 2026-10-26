import { describe, expect, it, vi } from 'vitest'
import { needsEndConfirm, spawnWhenFree, startSessionFlow } from './sessionStart'

const conflict = {
  ok: false as const,
  error: {
    code: 'CONFLICT' as const,
    message: 'Choose a working folder first',
    details: { reason: 'workdir_required' }
  }
}

describe('startSessionFlow', () => {
  it('sem pasta pergunta e grava na task', async () => {
    let n = 0
    const api = {
      ptySpawn: vi.fn(async () => {
        n += 1
        return n === 1 ? conflict : { ok: true as const, data: { session_id: 's1' } }
      }),
      sessionPickWorkdir: vi.fn(async () => ({ ok: true as const, data: '/w' })),
      taskSetWorkdir: vi.fn(async () => ({
        ok: true as const,
        data: { row: null, activity_id: 'a' }
      })),
      onExit: vi.fn(() => () => undefined)
    }
    await expect(
      startSessionFlow(api, {
        pty_id: 'p',
        task: 'T-1',
        task_id: 'task-1',
        tool: 'claude-code',
        cols: 80,
        rows: 24
      })
    ).resolves.toEqual({ ok: true, session_id: 's1' })
    expect(api.sessionPickWorkdir).toHaveBeenCalledOnce()
    expect(api.taskSetWorkdir).toHaveBeenCalledWith({ id: 'task-1', workdir: '/w' })
    expect(api.ptySpawn).toHaveBeenCalledTimes(2)
  })

  it('cancelar a pasta não abre', async () => {
    const api = {
      ptySpawn: vi.fn(async () => conflict),
      sessionPickWorkdir: vi.fn(async () => ({ ok: true as const, data: null })),
      taskSetWorkdir: vi.fn(),
      onExit: vi.fn(() => () => undefined)
    }
    await expect(
      startSessionFlow(api, {
        pty_id: 'p',
        task: 'T-1',
        task_id: 'task-1',
        tool: 'claude-code',
        cols: 80,
        rows: 24
      })
    ).resolves.toEqual({ ok: false, cancelled: true })
    expect(api.taskSetWorkdir).not.toHaveBeenCalled()
    expect(api.ptySpawn).toHaveBeenCalledOnce()
  })

  it('outro erro vira mensagem', async () => {
    const api = {
      ptySpawn: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'NOT_FOUND' as const, message: 'missing' }
      })),
      sessionPickWorkdir: vi.fn(),
      taskSetWorkdir: vi.fn(),
      onExit: vi.fn(() => () => undefined)
    }
    await expect(
      startSessionFlow(api, {
        pty_id: 'p',
        task: 'T-1',
        task_id: 'task-1',
        tool: 'codex',
        cols: 80,
        rows: 24
      })
    ).resolves.toEqual({ ok: false, message: 'missing' })
    expect(api.sessionPickWorkdir).not.toHaveBeenCalled()
  })
})

const busy = {
  ok: false as const,
  error: {
    code: 'CONFLICT' as const,
    message: 'The previous process is still shutting down',
    details: { reason: 'pty_busy' }
  }
}

describe('spawnWhenFree', () => {
  const exitBus = (): {
    onExit: (cb: (id: string, code: number) => void) => () => void
    emit: (id: string) => void
    listeners: () => number
  } => {
    const cbs = new Set<(id: string, code: number) => void>()
    return {
      onExit: (cb) => {
        cbs.add(cb)
        return () => void cbs.delete(cb)
      },
      emit: (id) => cbs.forEach((cb) => cb(id, 0)),
      listeners: () => cbs.size
    }
  }

  it('pty_busy espera o pty:exit do mesmo id e tenta de novo', async () => {
    const bus = exitBus()
    const ok = { ok: true as const, data: { session_id: 's2' } }
    const spawn = vi.fn().mockResolvedValueOnce(busy).mockResolvedValueOnce(ok)
    const p = spawnWhenFree(spawn, bus.onExit, 'p', { waitMs: 60_000 })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
    bus.emit('outro')
    await new Promise((r) => setTimeout(r, 5))
    expect(spawn).toHaveBeenCalledOnce()
    bus.emit('p')
    await expect(p).resolves.toEqual(ok)
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(bus.listeners()).toBe(0)
  })

  it('exit que chega antes da resposta não se perde', async () => {
    const bus = exitBus()
    const ok = { ok: true as const, data: { session_id: 's2' } }
    const spawn = vi
      .fn()
      .mockImplementationOnce(async () => {
        bus.emit('p')
        return busy
      })
      .mockResolvedValueOnce(ok)
    await expect(spawnWhenFree(spawn, bus.onExit, 'p', { waitMs: 60_000 })).resolves.toEqual(ok)
  })

  it('desiste depois das tentativas e devolve o pty_busy', async () => {
    const bus = exitBus()
    const spawn = vi.fn(async () => busy)
    await expect(spawnWhenFree(spawn, bus.onExit, 'p', { tries: 2, waitMs: 1 })).resolves.toEqual(
      busy
    )
    expect(spawn).toHaveBeenCalledTimes(3)
  })

  it('outro erro não tenta de novo', async () => {
    const bus = exitBus()
    const spawn = vi.fn(async () => conflict)
    await expect(spawnWhenFree(spawn, bus.onExit, 'p')).resolves.toEqual(conflict)
    expect(spawn).toHaveBeenCalledOnce()
  })
})

describe('needsEndConfirm', () => {
  it('só working pede confirmação', () => {
    expect(needsEndConfirm('working')).toBe(true)
    expect(needsEndConfirm('idle')).toBe(false)
    expect(needsEndConfirm('waiting')).toBe(false)
    expect(needsEndConfirm('unknown')).toBe(false)
    expect(needsEndConfirm(undefined)).toBe(false)
  })
})
