import { describe, expect, it } from 'vitest'
import { shimContent } from './shim'

describe('shimContent', () => {
  it('AppImage: exec do $APPIMAGE, 0755, nome turnflow', () => {
    expect(shimContent({ kind: 'appimage', appimage: '/home/j/Apps/T.AppImage' }, 'linux')).toEqual(
      {
        file: 'turnflow',
        body: '#!/bin/sh\nexec "/home/j/Apps/T.AppImage" "$@"\n',
        mode: 0o755
      }
    )
  })
  it('exec (deb/mac): path com espaço entre aspas', () => {
    const c = shimContent({ kind: 'exec', exec: '/Applications/My App/t' }, 'darwin')
    expect(c.file).toBe('turnflow')
    expect(c.body).toBe('#!/bin/sh\nexec "/Applications/My App/t" "$@"\n')
  })
  it('escapa os caracteres especiais das aspas duplas do sh', () => {
    const c = shimContent({ kind: 'exec', exec: '/x/a"b$c`d\\e' }, 'linux')
    expect(c.body).toBe('#!/bin/sh\nexec "/x/a\\"b\\$c\\`d\\\\e" "$@"\n')
  })
  it('dev: electron + appDir, nome turnflow-dev', () => {
    expect(
      shimContent(
        { kind: 'dev', electron: '/r/node_modules/electron/dist/electron', appDir: '/r' },
        'linux'
      )
    ).toEqual({
      file: 'turnflow-dev',
      body: '#!/bin/sh\nexec "/r/node_modules/electron/dist/electron" "/r" "$@"\n',
      mode: 0o755
    })
  })
  it('win32: .cmd com @"<exe>" %*', () => {
    const c = shimContent({ kind: 'exec', exec: 'C:\\Program Files\\T\\t.exe' }, 'win32')
    expect(c.file).toBe('turnflow.cmd')
    expect(c.body).toBe('@"C:\\Program Files\\T\\t.exe" %*\r\n')
  })
  it('win32 dev: turnflow-dev.cmd', () => {
    const c = shimContent({ kind: 'dev', electron: 'C:\\r\\e.exe', appDir: 'C:\\r' }, 'win32')
    expect(c.file).toBe('turnflow-dev.cmd')
    expect(c.body).toBe('@"C:\\r\\e.exe" "C:\\r" %*\r\n')
  })
  it('win32: % no path vira %% (senão o cmd expande)', () => {
    expect(shimContent({ kind: 'exec', exec: 'C:\\a%b\\t.exe' }, 'win32').body).toBe(
      '@"C:\\a%%b\\t.exe" %*\r\n'
    )
  })
})
