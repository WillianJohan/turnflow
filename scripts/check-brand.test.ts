import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkBrand } from './check-brand'

let root: string
const put = (rel: string, body: string): void => {
  const f = join(root, rel)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, body)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brand-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('checkBrand', () => {
  it('aceita o nome em src/shared/brand.ts', () => {
    put('src/shared/brand.ts', "export const name = 'Turnflow'")
    expect(checkBrand(root)).toEqual({ ok: true, offenders: [] })
  })
  it('reprova o nome fora do brand.ts, citando o arquivo', () => {
    put('src/x.ts', "const t = 'Turnflow'")
    const r = checkBrand(root)
    expect(r.ok).toBe(false)
    expect(r.offenders).toEqual(['src/x.ts'])
  })
  it('aceita o nome nos locais permitidos', () => {
    for (const f of [
      'docs/a.md',
      'e2e/a.spec.ts',
      'scripts/a.ts',
      'packaging/a.yml',
      '.github/workflows/a.yml',
      'README.md',
      'package.json',
      'NOTICE'
    ])
      put(f, 'Turnflow')
    expect(checkBrand(root).ok).toBe(true)
  })
  it('aceita o identificador minúsculo em src', () => {
    put('src/x.ts', "const db = 'turnflow.db'")
    expect(checkBrand(root).ok).toBe(true)
  })
  it('ignora node_modules e out', () => {
    put('node_modules/p/x.ts', 'Turnflow')
    put('out/x.js', 'Turnflow')
    expect(checkBrand(root).ok).toBe(true)
  })
})
