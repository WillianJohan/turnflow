// Falha se o bundle de release carrega algo do build de teste (ganchos TURNFLOW_TEST_*).
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { fileURLToPath } from 'url'

const LEAK = 'TURNFLOW_TEST_'
const CODE = /\.(c|m)?js$/

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ok, offenders } = checkRelease(process.argv[2] ?? 'out')
  if (!ok) {
    console.error('check-release: gancho de teste no bundle de release:')
    for (const f of offenders) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log('check-release: ok')
}
