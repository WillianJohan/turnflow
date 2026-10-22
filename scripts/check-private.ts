// Falha se um arquivo versionado leva herança pessoal ou de empresa: nome da empresa, home de
// usuário, e-mail real ou o nome do app legado fora da allowlist (Decisão 26; antecipa a E20.3).
// Todo literal proibido é montado em runtime para o script não reprovar a si mesmo.
// Roda com tsx (importa o check-brand sem extensão).
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { BINARY, SKIP_DIRS, SKIP_FILES } from './check-brand'

const COMPANY = ['Digi', 'talk'].join('')
const HOME = '/ho' + 'me/'
const LEGACY = ['dk', 'desk'].join('')

const EMAIL = /[\w.+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g
const OK_MAIL_DOMAINS = ['example.com', 'example.org', 'users.noreply.github.com']
const okMail = (m: string): boolean => {
  const domain = m.slice(m.lastIndexOf('@') + 1).toLowerCase()
  return OK_MAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))
}

type Pattern = { name: string; hit: (line: string) => boolean; allowed?: (file: string) => boolean }

// a home em /var (Silverblue) contém o mesmo trecho: um padrão cobre as duas formas.
const PATTERNS: Pattern[] = [
  {
    name: 'legacy-app-name',
    hit: (l) => l.toLowerCase().includes(LEGACY),
    allowed: (f) =>
      f.startsWith(`src/core/import/${LEGACY}/`) ||
      ['src/shared/paths.ts', 'src/shared/copy/import.ts', 'src/main/ipc/import.ts'].includes(f)
  },
  { name: 'company-name', hit: (l) => l.toLowerCase().includes(COMPANY.toLowerCase()) },
  { name: 'home-path', hit: (l) => l.includes(HOME) },
  { name: 'email', hit: (l) => (l.match(EMAIL) ?? []).some((m) => !okMail(m)) }
]

const skipped = (file: string): boolean => {
  const parts = file.split('/')
  const name = parts.at(-1)!
  return (
    file === 'NOTICE' ||
    SKIP_FILES.has(name) ||
    BINARY.test(name) ||
    parts.slice(0, -1).some((d) => SKIP_DIRS.has(d))
  )
}
// a linha "author" do package.json é a única exceção dentro de um arquivo
const exemptLine = (file: string, line: string): boolean =>
  file === 'package.json' && /^\s*"author"\s*:/.test(line)

const tracked = (root: string): string[] =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\0')
    .filter(Boolean)

export function checkPrivate(root: string): {
  ok: boolean
  offenders: { file: string; pattern: string }[]
} {
  const offenders: { file: string; pattern: string }[] = []
  for (const file of tracked(root)) {
    if (skipped(file)) continue
    let text: string
    try {
      text = readFileSync(join(root, file), 'utf8')
    } catch {
      continue // versionado mas apagado da árvore: não vai pro commit
    }
    const lines = text.split('\n').filter((l) => !exemptLine(file, l))
    for (const p of PATTERNS) {
      if (p.allowed?.(file)) continue
      if (lines.some(p.hit)) offenders.push({ file, pattern: p.name })
    }
  }
  offenders.sort((a, b) => a.file.localeCompare(b.file) || a.pattern.localeCompare(b.pattern))
  return { ok: offenders.length === 0, offenders }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ok, offenders } = checkPrivate(process.cwd())
  if (!ok) {
    console.error('dado pessoal ou de empresa em arquivo versionado:')
    for (const o of offenders) console.error(`  ${o.file} (${o.pattern})`)
    process.exit(1)
  }
  console.log('check-private: ok')
}
