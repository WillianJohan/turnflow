import { afterEach, expect, it } from 'vitest'
import { allowDebug, debugTarget } from './debug'

afterEach(() => allowDebug(false))

it('TURNFLOW_DEBUG é ignorado no release e vale em dev/teste', () => {
  const env = { TURNFLOW_DEBUG: '/tmp/pty.log' }
  expect(debugTarget(env)).toBeNull()
  allowDebug(true)
  expect(debugTarget(env)).toBe('/tmp/pty.log')
  expect(debugTarget({})).toBeNull()
})
