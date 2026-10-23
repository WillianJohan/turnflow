import { describe, expect, it, vi } from 'vitest'
import type { PtySpawner } from '../pty'
import { testSpawner } from './pty'

const proc = {
  pid: 1,
  onData: () => undefined,
  onExit: () => undefined,
  write: () => undefined,
  resize: () => undefined,
  kill: () => undefined
}
const o = { cols: 80, rows: 24, cwd: '/w', env: { PATH: '/bin', A: '1' } }

describe('testSpawner', () => {
  it('claude vira bash com o script e o mesmo env', () => {
    const real = vi.fn<PtySpawner>(() => proc)
    const spawner = testSpawner({ TURNFLOW_TEST_PTY: '/tmp/notify.sh' }, real, () => [])
    spawner('claude', ['--resume', 'u'], o)
    expect(real).toHaveBeenCalledWith('bash', ['--norc', '--noprofile', '/tmp/notify.sh'], o)
  })

  it('comando configurado de Outra também vira bash', () => {
    const real = vi.fn<PtySpawner>(() => proc)
    const spawner = testSpawner({ TURNFLOW_TEST_PTY: '/tmp/notify.sh' }, real, () => ['my-ai'])
    spawner('/usr/bin/my-ai', ['x'], o)
    expect(real).toHaveBeenCalledWith('bash', ['--norc', '--noprofile', '/tmp/notify.sh'], o)
  })

  it('shell passa direto', () => {
    const real = vi.fn<PtySpawner>(() => proc)
    const spawner = testSpawner({ TURNFLOW_TEST_PTY: '/tmp/notify.sh' }, real, () => ['my-ai'])
    spawner('/bin/bash', ['-i'], o)
    expect(real).toHaveBeenCalledWith('/bin/bash', ['-i'], o)
  })

  it('sem TURNFLOW_TEST_PTY devolve o spawner real', () => {
    const real = vi.fn<PtySpawner>(() => proc)
    expect(testSpawner({}, real, () => ['my-ai'])).toBe(real)
  })
})
