import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChangeBus, type Change } from './changeBus'
import type { DomainChanged } from '../shared/ipc/events'

// Fake de transação: as mudanças só chegam no afterCommit se o commit acontecer
type FakeDb = { tx(fn: (write: (c: Change) => void) => void): void }
function fakeDb(afterCommit: (c: Change) => void): FakeDb {
  return {
    tx(fn: (write: (c: Change) => void) => void): void {
      const pending: Change[] = []
      try {
        fn((c) => pending.push(c))
      } catch {
        return // rollback: nada sai
      }
      pending.forEach(afterCommit)
    }
  }
}

describe('createChangeBus', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  it('30 commits em 50 ms viram 1 emit com os ids únicos', () => {
    const emit = vi.fn<(e: DomainChanged) => void>()
    const bus = createChangeBus({ emit })
    const db = fakeDb(bus.afterCommit)
    for (let i = 0; i < 30; i++) {
      db.tx((w) => w({ entity: 'task', ids: [`t${i}`, 't0'], op: 'upsert' }))
      vi.advanceTimersByTime(1)
    }
    expect(emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(emit).toHaveBeenCalledTimes(1)
    const ids = emit.mock.calls[0][0].ids
    expect(ids).toHaveLength(30)
    expect(new Set(ids).size).toBe(30)
    expect(emit.mock.calls[0][0]).toMatchObject({ entity: 'task', op: 'upsert' })
  })
  it('entity diferentes viram emits separados', () => {
    const emit = vi.fn()
    const bus = createChangeBus({ emit })
    bus.afterCommit({ entity: 'task', ids: ['a'], op: 'upsert' })
    bus.afterCommit({ entity: 'project', ids: ['p'], op: 'upsert' })
    vi.advanceTimersByTime(50)
    expect(emit).toHaveBeenCalledTimes(2)
  })
  it('op diferente na mesma entity também separa', () => {
    const emit = vi.fn()
    const bus = createChangeBus({ emit })
    bus.afterCommit({ entity: 'task', ids: ['a'], op: 'upsert' })
    bus.afterCommit({ entity: 'task', ids: ['b'], op: 'delete' })
    vi.advanceTimersByTime(50)
    expect(emit.mock.calls.map((c) => c[0])).toEqual([
      { entity: 'task', ids: ['a'], op: 'upsert' },
      { entity: 'task', ids: ['b'], op: 'delete' }
    ])
  })
  it('nada é emitido antes do commit; rollback não emite', () => {
    const emit = vi.fn()
    const bus = createChangeBus({ emit })
    const db = fakeDb(bus.afterCommit)
    db.tx((w) => {
      w({ entity: 'task', ids: ['a'], op: 'upsert' })
      vi.advanceTimersByTime(100)
      expect(emit).not.toHaveBeenCalled() // ainda dentro da transação
      throw new Error('rollback')
    })
    vi.advanceTimersByTime(100)
    expect(emit).not.toHaveBeenCalled()
  })
  it('janela nova depois de emitir', () => {
    const emit = vi.fn()
    const bus = createChangeBus({ emit, windowMs: 10 })
    bus.afterCommit({ entity: 'task', ids: ['a'], op: 'upsert' })
    vi.advanceTimersByTime(10)
    bus.afterCommit({ entity: 'task', ids: ['b'], op: 'upsert' })
    vi.advanceTimersByTime(10)
    expect(emit.mock.calls.map((c) => c[0].ids)).toEqual([['a'], ['b']])
  })
  it('dispose cancela a janela pendente', () => {
    const emit = vi.fn()
    const bus = createChangeBus({ emit })
    bus.afterCommit({ entity: 'task', ids: ['a'], op: 'upsert' })
    bus.dispose()
    vi.advanceTimersByTime(100)
    expect(emit).not.toHaveBeenCalled()
  })
  it('emit que lança não trava as próximas janelas', () => {
    const emit = vi.fn().mockImplementationOnce(() => {
      throw new Error('janela fechada')
    })
    const bus = createChangeBus({ emit })
    bus.afterCommit({ entity: 'task', ids: ['a'], op: 'upsert' })
    bus.afterCommit({ entity: 'flow', ids: ['f'], op: 'upsert' })
    vi.advanceTimersByTime(50)
    expect(emit).toHaveBeenCalledTimes(2)
    bus.afterCommit({ entity: 'task', ids: ['b'], op: 'upsert' })
    vi.advanceTimersByTime(50)
    expect(emit).toHaveBeenCalledTimes(3)
  })
})
