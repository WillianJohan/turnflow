import { describe, expect, it } from 'vitest'
import { BRAND } from './brand'
import { binDir, configDir, runDir, socketPath } from './paths'

const home = '/home/u'

describe('paths', () => {
  it('linux com XDG_RUNTIME_DIR: socket em /run/user', () => {
    const env = { XDG_RUNTIME_DIR: '/run/user/1000' }
    expect(socketPath(env, 'linux', home)).toBe('/run/user/1000/turnflow/turnflow.sock')
    expect(runDir(env, 'linux', home)).toBe('/run/user/1000/turnflow')
  })
  it('linux sem XDG: socket dentro da config', () => {
    expect(socketPath({}, 'linux', home)).toBe('/home/u/.config/turnflow/run/turnflow.sock')
    expect(configDir({}, 'linux', home)).toBe('/home/u/.config/turnflow')
    expect(binDir({}, 'linux', home)).toBe('/home/u/.config/turnflow/bin')
  })
  it('XDG_CONFIG_HOME muda a config', () => {
    expect(configDir({ XDG_CONFIG_HOME: '/c' }, 'linux', home)).toBe('/c/turnflow')
  })
  it('dev usa turnflow-dev', () => {
    expect(configDir({}, 'linux', home, true)).toBe('/home/u/.config/turnflow-dev')
    expect(socketPath({}, 'linux', home, true)).toBe(
      '/home/u/.config/turnflow-dev/run/turnflow.sock'
    )
    expect(socketPath({ XDG_RUNTIME_DIR: '/run/user/1000' }, 'linux', home, true)).toBe(
      '/run/user/1000/turnflow-dev/turnflow.sock'
    )
  })
  it('TURNFLOW_CONFIG_DIR vence', () => {
    const env = { TURNFLOW_CONFIG_DIR: '/tmp/x' }
    expect(configDir(env, 'linux', home)).toBe('/tmp/x')
    expect(binDir(env, 'linux', home)).toBe('/tmp/x/bin')
  })
  it('TURNFLOW_SOCKET vence', () => {
    expect(socketPath({ TURNFLOW_SOCKET: '/tmp/s.sock' }, 'linux', home)).toBe('/tmp/s.sock')
  })
  it('mac usa Application Support', () => {
    expect(socketPath({}, 'darwin', '/Users/u')).toBe(
      `/Users/u/Library/Application Support/${BRAND.name}/run/turnflow.sock`
    )
  })
  it('win32 usa named pipe', () => {
    expect(
      socketPath({ USERNAME: 'u' }, 'win32', 'C:\\Users\\u').startsWith('\\\\.\\pipe\\turnflow-')
    ).toBe(true)
  })
  it('nenhum resultado contém dkdesk', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const)
      for (const dev of [false, true])
        for (const fn of [configDir, socketPath, binDir, runDir])
          expect(fn({}, platform, home, dev).toLowerCase()).not.toContain('dkdesk')
  })
})
