// Falha se o bundle de release carrega algo do build de teste (ganchos TURNFLOW_TEST_*) e, se o
// pacote já existe (dist/*/resources/app.asar), se ele leva código de teste ou caminho pessoal.
import asar from '@electron/asar'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, relative, sep } from 'path'
import { fileURLToPath } from 'url'

const LEAK = 'TURNFLOW_TEST_'
const CODE = /\.(c|m)?js$/
/** Raízes que nunca entram no pacote: código de teste, fontes, notas de trabalho. */
const FORBIDDEN = ['out-test', '.superpowers', 'e2e', 'scripts', 'test-results', 'src', 'docs']

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) yield* walk(full)
    else if (e.isFile() && CODE.test(e.name)) yield full
  }
}

export function checkRelease(outDir: string): { ok: boolean; offenders: string[] } {
  if (!existsSync(outDir)) return { ok: false, offenders: [`${outDir} (não existe: rode o build)`] }
  const offenders: string[] = []
  let scanned = 0
  for (const file of walk(outDir)) {
    scanned++
    if (readFileSync(file, 'utf8').includes(LEAK))
      offenders.push(relative(outDir, file).split(sep).join('/'))
  }
  if (scanned === 0) return { ok: false, offenders: [`${outDir} (nenhum .js: rode o build)`] }
  offenders.sort()
  return { ok: offenders.length === 0, offenders }
}

/**
 * Varre o `app.asar`: raiz proibida, gancho de teste em código e o diretório home de quem
 * empacotou (`home`) em qualquer arquivo. Os nativos desempacotados (`.unpacked`) ficam de fora.
 */
export function checkAsar(archive: string, home?: string): { ok: boolean; offenders: string[] } {
  if (!existsSync(archive)) return { ok: false, offenders: [`${archive} (não existe)`] }
  const offenders = new Set<string>()
  for (const entry of asar.listPackage(archive, { isPack: false })) {
    const rel = entry.replace(/\\/g, '/').replace(/^\//, '')
    const root = rel.split('/')[0]
    if (FORBIDDEN.includes(root)) {
      offenders.add(`${root}/ (não deveria estar no pacote)`)
      continue
    }
    const st = asar.statFile(archive, rel, false) as {
      files?: unknown
      link?: unknown
      unpacked?: boolean
    }
    if (st.files || st.link || st.unpacked) continue
    const text = asar.extractFile(archive, rel).toString('latin1')
    if (CODE.test(rel) && text.includes(LEAK)) offenders.add(`${rel} (gancho de teste)`)
    if (home && text.includes(home)) offenders.add(`${rel} (caminho pessoal)`)
  }
  return { ok: offenders.size === 0, offenders: [...offenders].sort() }
}

/** `app.asar` de cada saída `--dir` em `dist` (linux-unpacked, win-unpacked...). */
export function packagedAsars(distDir: string): string[] {
  if (!existsSync(distDir)) return []
  return readdirSync(distDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(distDir, e.name, 'resources', 'app.asar'))
    .filter((f) => existsSync(f))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [outDir = 'out', distDir = 'dist'] = process.argv.slice(2)
  let failed = false
  const { ok, offenders } = checkRelease(outDir)
  if (!ok) {
    failed = true
    console.error('check-release: gancho de teste no bundle de release:')
    for (const f of offenders) console.error(`  ${f}`)
  }
  for (const archive of packagedAsars(distDir)) {
    const r = checkAsar(archive, homedir())
    if (r.ok) console.log(`check-release: ${archive} ok`)
    else {
      failed = true
      console.error(`check-release: ${archive} leva o que não devia:`)
      for (const f of r.offenders) console.error(`  ${f}`)
    }
  }
  if (failed) process.exit(1)
  console.log('check-release: ok')
}
