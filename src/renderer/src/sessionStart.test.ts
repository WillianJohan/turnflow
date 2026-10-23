import { describe, expect, it, vi } from 'vitest'
import { needsEndConfirm, startSessionFlow } from './sessionStart'

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
      }))
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
      taskSetWorkdir: vi.fn()
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
      taskSetWorkdir: vi.fn()
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

describe('needsEndConfirm', () => {
  it('só working pede confirmação', () => {
    expect(needsEndConfirm('working')).toBe(true)
    expect(needsEndConfirm('idle')).toBe(false)
    expect(needsEndConfirm('waiting')).toBe(false)
    expect(needsEndConfirm('unknown')).toBe(false)
    expect(needsEndConfirm(undefined)).toBe(false)
  })
})
