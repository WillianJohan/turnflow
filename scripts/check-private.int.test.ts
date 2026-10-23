import { execFileSync } from 'child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tmpDir } from '../src/core/testing/db'
import { checkPrivate } from './check-private'

// Todo literal proibido é montado em runtime, como no script: o próprio teste tem que passar no
// check-private do repo real.
const COMPANY = ['Digi', 'talk'].join('')
const HOME = '/ho' + 'me/'
const LEGACY = ['dk', 'desk'].join('')
const mail = (user: string, domain: string): string => [user, domain].join('@')

let root: string
const put = (rel: string, body: string, track = true): void => {
  const f = join(root, rel)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, body)
  if (track) execFileSync('git', ['add', '--', rel], { cwd: root })
}
const offenders = (): { file: string; pattern: string }[] => checkPrivate(root).offenders

beforeEach(() => {
  root = tmpDir()
  execFileSync('git', ['init', '-q'], { cwd: root })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('checkPrivate', () => {
  it('repo limpo passa', () => {
    put('src/a.ts', 'export const a = 1')
    expect(checkPrivate(root)).toEqual({ ok: true, offenders: [] })
  })

  it('path com Documents/ + nome da empresa é offender, em qualquer caixa', () => {
    put('src/config.ts', `const p = 'Documents/${COMPANY}'`)
    put('docs/x.md', `veja ${COMPANY.toLowerCase()}.example`)
    const r = checkPrivate(root)
    expect(r.ok).toBe(false)
    expect(r.offenders).toEqual([
      { file: 'docs/x.md', pattern: 'company-name' },
      { file: 'src/config.ts', pattern: 'company-name' }
    ])
  })

  it('home de exemplo com o prefixo proibido num teste é offender (as duas formas)', () => {
    put('src/paths.test.ts', `const home = '${HOME}u'`)
    put('src/b.test.ts', `const home = '/var${HOME}u'`)
    expect(offenders()).toEqual([
      { file: 'src/b.test.ts', pattern: 'home-path' },
      { file: 'src/paths.test.ts', pattern: 'home-path' }
    ])
  })

  it('e-mail real é offender; domínios de exemplo e noreply do GitHub não', () => {
    put('src/a.ts', `const who = '${mail('a', 'b.io')}'`)
    put(
      'src/b.ts',
      [
        mail('x', 'example.com'),
        mail('y', 'git.example.org'),
        mail('123+u', 'users.noreply.github.com')
      ].join('\n')
    )
    expect(offenders()).toEqual([{ file: 'src/a.ts', pattern: 'email' }])
  })

  it('versão de pacote não é e-mail', () => {
    put('docs/spike.md', 'electron@44.9.3 e @scope/pkg@1.2.3-beta.1')
    expect(offenders()).toEqual([])
  })

  it('nome do app legado só na allowlist', () => {
    put('src/main/x.ts', `const n = '${LEGACY.toUpperCase()}'`)
    put(`src/core/import/${LEGACY}/a.ts`, `const n = '${LEGACY}'`)
    put('src/main/ipc/import.ts', `import '../../core/import/${LEGACY}/a'`)
    put('src/shared/paths.ts', `const n = '${LEGACY}'`)
    put('src/shared/copy/import.ts', `const n = 'Import from ${LEGACY}'`)
    expect(offenders()).toEqual([{ file: 'src/main/x.ts', pattern: 'legacy-app-name' }])
  })

  it('a allowlist do app legado não libera os outros padrões', () => {
    put(`src/core/import/${LEGACY}/a.ts`, `const p = '${HOME}u'`)
    expect(offenders()).toEqual([{ file: `src/core/import/${LEGACY}/a.ts`, pattern: 'home-path' }])
  })

  it('só a linha "author" do package.json é exceção', () => {
    put(
      'package.json',
      `{\n  "name": "x",\n  "author": "Nome Qualquer <${mail('a', 'b.io')}>"\n}\n`
    )
    expect(offenders()).toEqual([])
    put('package.json', `{\n  "bugs": "${mail('a', 'b.io')}"\n}\n`)
    expect(offenders()).toEqual([{ file: 'package.json', pattern: 'email' }])
  })

  it('NOTICE e package-lock.json ficam de fora', () => {
    put('NOTICE', `Copyright ${COMPANY} <${mail('a', 'b.io')}>`)
    put('package-lock.json', `{ "author": "${mail('i', 'izs.me')}", "x": "${mail('c', 'd.io')}" }`)
    expect(offenders()).toEqual([])
  })

  it('arquivo não versionado é ignorado', () => {
    put('src/a.ts', 'ok')
    put('notes.md', `${COMPANY} ${HOME}`, false)
    expect(offenders()).toEqual([])
  })

  it('binário e pasta pulada pelo check-brand ficam de fora', () => {
    put('assets/logo.png', COMPANY)
    put('out/main.js', COMPANY)
    expect(offenders()).toEqual([])
  })

  it('um offender por arquivo e padrão, mesmo com várias linhas', () => {
    put('src/a.ts', `${COMPANY}\n${COMPANY}\n${HOME}`)
    expect(offenders()).toEqual([
      { file: 'src/a.ts', pattern: 'company-name' },
      { file: 'src/a.ts', pattern: 'home-path' }
    ])
  })

  it('o próprio script e este teste passam (copiados e versionados no repo falso)', () => {
    for (const f of ['check-private.ts', 'check-private.int.test.ts'])
      put(`scripts/${f}`, readFileSync(join(__dirname, f), 'utf8'))
    expect(offenders()).toEqual([])
  })
})
