// Garante que o nome de exibição "Turnflow" só aparece onde é permitido.
// Em src o nome vem de BRAND (src/shared/brand.ts); identificadores minúsculos
// (turnflow.db, TURNFLOW_*) não entram na regra.
import { readdirSync, readFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { fileURLToPath } from 'url'

const NAME = 'Turnflow'
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'out',
  'out-test',
  'dist',
  '.superpowers',
  'test-results',
  'playwright-report'
])
const SKIP_FILES = new Set(['package-lock.json', '.eslintcache'])
const BINARY = /\.(png|ico|icns|jpg|jpeg|gif|woff2?|ttf|pdf|zip)$/i
const ALLOWED_FILES = new Set([
  'src/shared/brand.ts',
  'package.json',
  'electron-builder.yml',
  'LICENSE',
  'NOTICE',
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md'
])
const ALLOWED_DIRS = ['packaging/', '.github/', 'docs/', 'e2e/', 'scripts/']

const isAllowed = (rel: string): boolean =>
  ALLOWED_FILES.has(rel) || ALLOWED_DIRS.some((d) => rel.startsWith(d))

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(full)
    } else if (e.isFile() && !SKIP_FILES.has(e.name) && !BINARY.test(e.name)) yield full
  }
}

export function checkBrand(root: string): { ok: boolean; offenders: string[] } {
  const offenders: string[] = []
  for (const file of walk(root)) {
    const rel = relative(root, file).split(sep).join('/')
    if (isAllowed(rel)) continue
    if (readFileSync(file, 'utf8').includes(NAME)) offenders.push(rel)
  }
  offenders.sort()
  return { ok: offenders.length === 0, offenders }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ok, offenders } = checkBrand(process.cwd())
  if (!ok) {
    console.error(`"${NAME}" fora dos locais permitidos (use BRAND.name):`)
    for (const f of offenders) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log('check-brand: ok')
}
