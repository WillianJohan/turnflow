import { describe, expect, it } from 'vitest'
import { detectShimTarget, shimContent } from './shim'

describe('shimContent', () => {
  it('AppImage: exec do $APPIMAGE, 0755, nome turnflow', () => {
    expect(
      shimContent({ kind: 'appimage', appimage: '/users/j/Apps/T.AppImage' }, 'linux')
    ).toEqual({
      file: 'turnflow',
      body: '#!/bin/sh\nunset ELECTRON_RUN_AS_NODE\nexec "/users/j/Apps/T.AppImage" "$@"\n',
      mode: 0o755
    })
  })
  it('exec (deb/mac): path com espaço entre aspas', () => {
    const c = shimContent({ kind: 'exec', exec: '/Applications/My App/t' }, 'darwin')
    expect(c.file).toBe('turnflow')
    expect(c.body).toBe(
      '#!/bin/sh\nunset ELECTRON_RUN_AS_NODE\nexec "/Applications/My App/t" "$@"\n'
    )
  })
  it('escapa os caracteres especiais das aspas duplas do sh', () => {
    const c = shimContent({ kind: 'exec', exec: '/x/a"b$c`d\\e' }, 'linux')
    expect(c.body).toBe(
      '#!/bin/sh\nunset ELECTRON_RUN_AS_NODE\nexec "/x/a\\"b\\$c\\`d\\\\e" "$@"\n'
    )
  })
  it('dev: electron + appDir, nome turnflow-dev', () => {
    expect(
      shimContent(
        { kind: 'dev', electron: '/r/node_modules/electron/dist/electron', appDir: '/r' },
        'linux'
      )
    ).toEqual({
      file: 'turnflow-dev',
      body: '#!/bin/sh\nunset ELECTRON_RUN_AS_NODE\nexec "/r/node_modules/electron/dist/electron" "/r" "$@"\n',
      mode: 0o755
    })
  })
  it('win32: .cmd com @"<exe>" %*', () => {
    const c = shimContent({ kind: 'exec', exec: 'C:\\Program Files\\T\\t.exe' }, 'win32')
    expect(c.file).toBe('turnflow.cmd')
    expect(c.body).toBe('@set ELECTRON_RUN_AS_NODE=\r\n@"C:\\Program Files\\T\\t.exe" %*\r\n')
  })
  it('win32 dev: turnflow-dev.cmd', () => {
    const c = shimContent({ kind: 'dev', electron: 'C:\\r\\e.exe', appDir: 'C:\\r' }, 'win32')
    expect(c.file).toBe('turnflow-dev.cmd')
    expect(c.body).toBe('@set ELECTRON_RUN_AS_NODE=\r\n@"C:\\r\\e.exe" "C:\\r" %*\r\n')
  })
  it('win32: % no path vira %% (senão o cmd expande)', () => {
    expect(shimContent({ kind: 'exec', exec: 'C:\\a%b\\t.exe' }, 'win32').body).toBe(
      '@set ELECTRON_RUN_AS_NODE=\r\n@"C:\\a%%b\\t.exe" %*\r\n'
    )
  })
})

describe('detectShimTarget', () => {
  const base = {
    execPath: '/tmp/.mount_TxYz/turnflow',
    appPath: '/tmp/.mount_TxYz/resources/app.asar'
  }
  it('AppImage: APPIMAGE setado e execPath dentro do APPDIR', () => {
    expect(
      detectShimTarget({
        ...base,
        dev: false,
        env: { APPIMAGE: '/h/T.AppImage', APPDIR: '/tmp/.mount_TxYz' }
      })
    ).toEqual({ kind: 'appimage', appimage: '/h/T.AppImage' })
  })
  it('APPIMAGE herdado (execPath fora do APPDIR) → exec', () => {
    expect(
      detectShimTarget({
        dev: false,
        execPath: '/opt/T/turnflow',
        appPath: '/opt/T/resources/app.asar',
        env: { APPIMAGE: '/h/Outro.AppImage', APPDIR: '/tmp/.mount_Outro' }
      })
    ).toEqual({ kind: 'exec', exec: '/opt/T/turnflow' })
  })
  it('APPIMAGE sem APPDIR → exec', () => {
    expect(detectShimTarget({ ...base, dev: false, env: { APPIMAGE: '/h/T.AppImage' } })).toEqual({
      kind: 'exec',
      exec: base.execPath
    })
  })
  it('dev vence APPIMAGE (electron . aberto de dentro de um AppImage)', () => {
    expect(
      detectShimTarget({
        dev: true,
        execPath: '/r/node_modules/electron/dist/electron',
        appPath: '/r',
        env: { APPIMAGE: '/h/T.AppImage', APPDIR: '/r' }
      })
    ).toEqual({ kind: 'dev', electron: '/r/node_modules/electron/dist/electron', appDir: '/r' })
  })
  it('empacotado comum → exec', () => {
    expect(detectShimTarget({ dev: false, execPath: '/opt/T/t', appPath: '/x', env: {} })).toEqual({
      kind: 'exec',
      exec: '/opt/T/t'
    })
  })
})
