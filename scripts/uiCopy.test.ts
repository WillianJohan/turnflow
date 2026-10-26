import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { describe, expect, it } from 'vitest'
import { uiLiterals } from './uiCopy'

const texts = (src: string): string[] => uiLiterals(src).map((l) => l.text)

describe('uiLiterals: contornos', () => {
  it('acusa texto solto no JSX', () => {
    expect(texts('const A = () => <p>Hello there</p>')).toEqual(['Hello there'])
    expect(texts("const A = () => <p>{'Hello'}</p>")).toEqual(['Hello'])
    expect(texts('const A = (n: number) => <p>{n > 1 ? `${n} items` : "One item"}</p>')).toEqual([
      'items',
      'One item'
    ])
    expect(texts('const A = () => <p>Sessão {x}.</p>')).toEqual(['Sessão'])
  })

  it('acusa atributo de texto literal, em chaves, template, ternário, + e ??', () => {
    expect(texts('<b title="Close tab" />')).toEqual(['Close tab'])
    expect(texts("<b aria-label={'Menu'} />")).toEqual(['Menu'])
    expect(texts('<b placeholder={`Search ${q}`} />')).toEqual(['Search'])
    expect(texts("<b title={on ? 'Hide' : 'Show'} />")).toEqual(['Hide', 'Show'])
    expect(texts("<b label={'Tab ' + n} />")).toEqual(['Tab'])
    expect(texts("<b alt={name ?? 'Logo'} />")).toEqual(['Logo'])
    expect(texts('<C body="Are you sure" confirm="Yes" cancel="No" action="Undo" />')).toEqual([
      'Are you sure',
      'Yes',
      'No',
      'Undo'
    ])
  })

  it('deixa passar copy, nomes de produto, comparação, pontuação e atributos que não são texto', () => {
    expect(texts('<b title={COPY.close}>{COPY.label}</b>')).toEqual([])
    expect(texts('<b>Codex</b>')).toEqual([])
    expect(texts("<kbd>{'Ctrl+Shift+D'}</kbd>")).toEqual([])
    expect(texts("<b title={`themes/${id}.json`}><code>{'config.json'}</code></b>")).toEqual([])
    expect(texts("<b title={mode === 'term' ? A : B} />")).toEqual([])
    expect(texts('<b>{x} · {y} —</b>')).toEqual([])
    expect(texts('<b className="item open" role="option" type="button" data-x="Nope" />')).toEqual(
      []
    )
  })
})

// Todas as telas do renderer (glob, não lista fixa). Teste e catálogo do DS ficam de fora.
const ROOT = join(__dirname, '..', 'src', 'renderer', 'src')
const SKIP = [/\.test\.tsx$/, /^ui\/catalog\.tsx$/, /^testing\//]
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return tsxFiles(full)
    return name.endsWith('.tsx') ? [full] : []
  })
}

it('nenhuma tela do renderer tem texto de UI solto', () => {
  const bad = tsxFiles(ROOT)
    .map((f) => relative(ROOT, f).replaceAll('\\', '/'))
    .filter((rel) => !SKIP.some((re) => re.test(rel)))
    .flatMap((rel) =>
      uiLiterals(readFileSync(join(ROOT, rel), 'utf8'), rel).map(
        (l) => `${rel}:${l.line} ${l.text}`
      )
    )
  expect(bad).toEqual([])
})
