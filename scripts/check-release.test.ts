import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkRelease } from './check-release'

let dir: string
const put = (rel: string, body: string): void => {
  const f = join(dir, rel)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, body)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'release-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('checkRelease', () => {
  it('falha citando o arquivo que vazou gancho de teste', () => {
    put('main/index.js', 'const a = 1')
    put('renderer/assets/app.js', 'x("TURNFLOW_TEST_PTY")')
    const r = checkRelease(dir)
    expect(r.ok).toBe(false)
    expect(r.offenders).toEqual(['renderer/assets/app.js'])
  })

  it('pega a marca de eliminação do módulo de teste', () => {
    put('main/index.js', 'log("TURNFLOW_TEST_MARK")')
    expect(checkRelease(dir).offenders).toEqual(['main/index.js'])
  })

  it('aceita saída sem nenhuma string de teste', () => {
    put('main/index.js', 'const a = 1')
    put('preload/index.js', 'const b = 2')
    expect(checkRelease(dir)).toEqual({ ok: true, offenders: [] })
  })

  it('falha se o diretório não existe ou está vazio (build não rodou)', () => {
    expect(checkRelease(join(dir, 'nada')).ok).toBe(false)
    expect(checkRelease(dir).ok).toBe(false)
  })
})
