import { mkdirSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { dirname } from 'path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { socketPath } from './paths'

let root: string
beforeEach(() => {
  root = mkdtempSync(`${tmpdir()}/paths-int-`)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('o diretório do socket derivado de TURNFLOW_CONFIG_DIR pode ser criado no FS real', () => {
  const sock = socketPath({ TURNFLOW_CONFIG_DIR: root }, 'linux', '/users/x', false)
  mkdirSync(dirname(sock), { recursive: true })
  expect(statSync(dirname(sock)).isDirectory()).toBe(true)
  expect(sock.startsWith(root)).toBe(true)
})
