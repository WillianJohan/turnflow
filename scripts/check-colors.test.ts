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

  it('reprova hex no index.html e em .js/.mjs do src', () => {
    put('src/renderer/index.html', '<body style="background: #101010"></body>')
    put('src/renderer/src/legacy.js', "export const c = '#abcdef'")
    put('src/renderer/src/tool.mjs', "export const c = '#abcdef'")
    expect(checkColors(root).offenders).toEqual([
      'src/renderer/index.html',
      'src/renderer/src/legacy.js',
      'src/renderer/src/tool.mjs'
    ])
  })

  it('aceita a paleta de amostras, e só ela além do tema', () => {
    put('src/shared/theme/swatches.ts', "export const s = ['#91918e']")
    put('src/shared/theme/other.ts', "export const s = ['#91918e']")
    expect(checkColors(root).offenders).toEqual(['src/shared/theme/other.ts'])
  })

  it('hex dentro de comentário não conta; fora do comentário, na mesma linha, conta', () => {
    put('src/renderer/src/a.css', '/* antes era #ff0000 */\n.a { color: var(--fg); }')
    put('src/renderer/src/b.ts', "// cinza #888888 do protótipo\nexport const url = 'https://x.dev'")
    put('src/renderer/index.html', '<!-- #fff -->\n<div></div>')
    put('src/renderer/src/c.ts', "export const u = 'https://x.dev'; export const c = '#abc'")
    expect(checkColors(root).offenders).toEqual(['src/renderer/src/c.ts'])
  })

  it('o repositório não tem hex fora de derive.ts e dos temas embutidos', () => {
    expect(checkColors(process.cwd()).offenders).toEqual([])
  })
})
