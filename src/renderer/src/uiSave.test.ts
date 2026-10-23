import { afterEach, expect, it, vi } from 'vitest'
import type { UiFile } from '../../shared/uiFile'
import { createUiSaver } from './uiSave'

const file = (id: string): UiFile => ({
  version: 1,
  layout: { panels: [{ tabs: [id], active: 0 }], focused: 0 },
  sidebar: { folded: false, width: 288 },
  home: 'list',
  fab: { edge: 'right', offset: 24 }
})

afterEach(() => {
  vi.useRealTimers()
})

it('vários pushes no meio do prazo gravam só o último, 500 ms depois', () => {
  vi.useFakeTimers()
  const saved: UiFile[] = []
  const saver = createUiSaver((next) => saved.push(next))
  saver.push(file('A'))
  saver.push(file('B'))
  vi.advanceTimersByTime(499)
  expect(saved).toEqual([])
  vi.advanceTimersByTime(1)
  expect(saved).toEqual([file('B')])
})

it('cancel descarta o que ainda não foi gravado', () => {
  vi.useFakeTimers()
  const saved: UiFile[] = []
  const saver = createUiSaver((next) => saved.push(next))
  saver.push(file('A'))
  saver.cancel()
  vi.advanceTimersByTime(500)
  expect(saved).toEqual([])
})

it('flush grava na hora', () => {
  vi.useFakeTimers()
  const saved: UiFile[] = []
  const saver = createUiSaver((next) => saved.push(next))
  saver.push(file('A'))
  saver.flush()
  expect(saved).toEqual([file('A')])
  vi.advanceTimersByTime(500)
  expect(saved).toEqual([file('A')])
})
