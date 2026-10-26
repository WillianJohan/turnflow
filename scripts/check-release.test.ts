import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import asar from '@electron/asar'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkAsar, checkRelease, packagedAsars } from './check-release'

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

describe('checkAsar', () => {
  const pack = async (): Promise<string> => {
    const archive = join(dir, 'dist', 'linux-unpacked', 'resources', 'app.asar')
    mkdirSync(dirname(archive), { recursive: true })
    await asar.createPackage(join(dir, 'app'), archive)
    return archive
  }

  it('aceita pacote só com out/ e package.json', async () => {
    put('app/out/main/index.js', 'const a = 1')
    put('app/package.json', '{}')
    const archive = await pack()
    expect(packagedAsars(join(dir, 'dist'))).toEqual([archive])
    expect(checkAsar(archive, '/users/quem-empacotou')).toEqual({ ok: true, offenders: [] })
  })

  it('aponta raiz proibida, gancho de teste e caminho pessoal', async () => {
    put('app/out/main/index.js', 'x("TURNFLOW_TEST_PTY")')
    put('app/out/main/chunk.js', 'const p = "/users/quem-empacotou/projeto"')
    put('app/out-test/main/index.js', 'teste')
    put('app/.superpowers/plano.md', 'notas')
    put('app/package.json', '{}')
    const r = checkAsar(await pack(), '/users/quem-empacotou')
    expect(r.ok).toBe(false)
    expect(r.offenders).toEqual([
      '.superpowers/ (não deveria estar no pacote)',
      'out-test/ (não deveria estar no pacote)',
      'out/main/chunk.js (caminho pessoal)',
      'out/main/index.js (gancho de teste)'
    ])
  })

  it('sem pacote: nada para varrer', () => {
    expect(packagedAsars(join(dir, 'dist'))).toEqual([])
  })
})
