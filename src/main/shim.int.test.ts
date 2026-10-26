import { execFileSync } from 'child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { shimContent, writeShim } from './shim'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'shim-int-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it.skipIf(process.platform === 'win32')(
  'shim gravado executa o alvo com path com espaço e repassa os args intactos',
  () => {
    const appDir = join(root, 'My App')
    mkdirSync(appDir)
    const fake = join(appDir, 'fake exe')
    writeFileSync(fake, '#!/bin/sh\nfor a in "$@"; do printf "[%s]" "$a"; done\n')
    chmodSync(fake, 0o755)
    const bin = join(root, 'cfg', 'bin')
    const content = shimContent({ kind: 'exec', exec: fake }, 'linux')
    writeShim(bin, content)
    const shim = join(bin, content.file)
    expect(statSync(shim).mode & 0o777).toBe(0o755)
    const out = execFileSync('sh', [shim, '--version', 'a b', '$HOME']).toString()
    expect(out).toBe('[--version][a b][$HOME]')
  }
)

it('writeShim reescreve o shim existente (start seguinte, path novo)', () => {
  const bin = join(root, 'bin')
  writeShim(bin, shimContent({ kind: 'appimage', appimage: '/v1.AppImage' }, 'linux'))
  writeShim(bin, shimContent({ kind: 'appimage', appimage: '/v2.AppImage' }, 'linux'))
  expect(readFileSync(join(bin, 'turnflow'), 'utf8')).toContain('/v2.AppImage')
})

it.skipIf(process.platform === 'win32')('shim executa o alvo sem ELECTRON_RUN_AS_NODE', () => {
  const fake = join(root, 'fake')
  writeFileSync(fake, '#!/bin/sh\nprintf "[%s]" "${ELECTRON_RUN_AS_NODE-unset}"\n')
  chmodSync(fake, 0o755)
  const bin = join(root, 'bin')
  const content = shimContent({ kind: 'exec', exec: fake }, 'linux')
  writeShim(bin, content)
  const out = execFileSync('sh', [join(bin, content.file)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }).toString()
  expect(out).toBe('[unset]')
})
