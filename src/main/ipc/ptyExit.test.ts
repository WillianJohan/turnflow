import { expect, it, vi } from 'vitest'
import { createPtyGuard } from '../ptyGuard'
import { onPtyExit } from './ptyExit'

it('exit do pty libera o dono, esquece uuid e aliases e avisa o renderer', () => {
  const guard = createPtyGuard()
  guard.register('t1', 7)
  const uuidOf = new Map([['t1', 'u-1']])
  const alias = new Map([
    ['antigo', 't1'],
    ['outro', 't2']
  ])
  const send = vi.fn()
  onPtyExit({ uuidOf, alias, guard, send }, 't1', 3)
  expect(guard.canWrite('t1', 7)).toBe(false)
  expect(uuidOf.has('t1')).toBe(false)
  expect([...alias]).toEqual([['outro', 't2']])
  expect(send.mock.calls).toEqual([
    ['pty:exit', 't1', 3],
    ['pty:state', 't1', 'idle']
  ])
})
