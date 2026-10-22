import { describe, expect, it } from 'vitest'
import { BRAND } from './brand'
import { binDir, cliUserDataDir, configDir, runDir, socketPath } from './paths'

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
  it('TURNFLOW_CONFIG_DIR isola o socket mesmo com XDG_RUNTIME_DIR (hash curto do config dir)', () => {
    const xdg = '/run/user/1000'
    const a = socketPath({ XDG_RUNTIME_DIR: xdg, TURNFLOW_CONFIG_DIR: '/tmp/a' }, 'linux', home)
    const b = socketPath({ XDG_RUNTIME_DIR: xdg, TURNFLOW_CONFIG_DIR: '/tmp/b' }, 'linux', home)
    expect(a).not.toBe(b)
    expect(a).toMatch(/^\/run\/user\/1000\/turnflow-[0-9a-f]{8}\/turnflow\.sock$/)
    expect(a).not.toBe('/run/user/1000/turnflow/turnflow.sock')
    const dev = socketPath(
      { XDG_RUNTIME_DIR: xdg, TURNFLOW_CONFIG_DIR: '/tmp/a' },
      'linux',
      home,
      true
    )
    expect(dev).toMatch(/^\/run\/user\/1000\/turnflow-[0-9a-f]{8}-dev\/turnflow\.sock$/)
    // estável: mesmo config dir → mesmo socket (o CLI e o app resolvem igual)
    expect(socketPath({ XDG_RUNTIME_DIR: xdg, TURNFLOW_CONFIG_DIR: '/tmp/a' }, 'linux', home)).toBe(
      a
    )
  })
  it('TURNFLOW_CONFIG_DIR sem XDG_RUNTIME_DIR: socket dentro do config dir', () => {
    expect(socketPath({ TURNFLOW_CONFIG_DIR: '/tmp/a' }, 'linux', home)).toBe(
      '/tmp/a/run/turnflow.sock'
    )
  })
  it('TURNFLOW_SOCKET vence', () => {
    expect(
      socketPath(
        { TURNFLOW_SOCKET: '/tmp/s.sock', TURNFLOW_CONFIG_DIR: '/tmp/a', XDG_RUNTIME_DIR: '/r' },
        'linux',
        home
      )
    ).toBe('/tmp/s.sock')
    expect(socketPath({ TURNFLOW_SOCKET: '/tmp/s.sock' }, 'linux', home)).toBe('/tmp/s.sock')
  })
  it('mac usa Application Support', () => {
    expect(socketPath({}, 'darwin', '/Users/u')).toBe(
      `/Users/u/Library/Application Support/${BRAND.name}/run/turnflow.sock`
    )
  })
  it('win32 usa named pipe com hash da identidade', () => {
    const home = 'C:\\Users\\alice'
    expect(socketPath({}, 'win32', home, false, 'alice@CORP')).toBe(
      '\\\\.\\pipe\\turnflow-d0ecd4b6'
    )
    expect(socketPath({}, 'win32', home, true, 'alice@CORP')).toBe(
      '\\\\.\\pipe\\turnflow-dev-d0ecd4b6'
    )
  })
  it('win32: usuários diferentes têm pipes diferentes e o nome não vaza o usuário', () => {
    const a = socketPath({}, 'win32', home, false, 'alice@CORP')
    const b = socketPath({}, 'win32', home, false, 'bob@CORP')
    expect(a).not.toBe(b)
    expect(a.toLowerCase()).not.toContain('alice')
  })
  it('nenhum resultado contém dkdesk', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const)
      for (const dev of [false, true])
        for (const fn of [configDir, socketPath, binDir, runDir])
          expect(fn({}, platform, home, dev).toLowerCase()).not.toContain('dkdesk')
  })
  it('cliUserDataDir: subpasta cli da config (segue dev e TURNFLOW_CONFIG_DIR)', () => {
    expect(cliUserDataDir({}, 'linux', home)).toBe('/home/u/.config/turnflow/cli')
    expect(cliUserDataDir({}, 'linux', home, true)).toBe('/home/u/.config/turnflow-dev/cli')
    expect(cliUserDataDir({ TURNFLOW_CONFIG_DIR: '/iso' }, 'linux', home)).toBe('/iso/cli')
    expect(cliUserDataDir({}, 'win32', 'C:\\Users\\u')).toBe(
      'C:\\Users\\u\\AppData\\Roaming\\Turnflow\\cli'
    )
  })
})
