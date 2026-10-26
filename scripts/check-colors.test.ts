import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkColors } from './check-colors'

let root: string
const put = (rel: string, body: string): void => {
  const f = join(root, rel)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, body)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'colors-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('checkColors', () => {
  it('aceita hex em derive.ts e nos temas embutidos', () => {
    put('src/shared/theme/derive.ts', "export const ink = '#111111'")
    put('src/shared/theme/builtins.ts', "export const bg = '#ffffff'")
    expect(checkColors(root)).toEqual({ ok: true, offenders: [] })
  })

  it('reprova hex no css e no renderer, citando o arquivo', () => {
    put('src/renderer/src/assets/main.css', 'button { color: #fff; }')
    put('src/renderer/src/ui/Button.tsx', "export const c = '#abc'")
    const r = checkColors(root)
    expect(r.ok).toBe(false)
    expect(r.offenders).toEqual([
      'src/renderer/src/assets/main.css',
      'src/renderer/src/ui/Button.tsx'
    ])
  })

  it('ignora seletor de id e arquivo de teste', () => {
    put('src/renderer/src/assets/main.css', '#root { margin: 0; }')
    put('src/renderer/src/theme.test.ts', "expect(bg).toBe('#fff')")
    expect(checkColors(root)).toEqual({ ok: true, offenders: [] })
  })

  it('o repositório não tem hex fora de derive.ts e dos temas embutidos', () => {
    expect(checkColors(process.cwd()).offenders).toEqual([])
  })
})
