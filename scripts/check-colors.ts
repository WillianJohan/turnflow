// Cor em hex só pode viver na derivação do tema e nos temas embutidos.
// O restante da UI usa variável CSS. A única outra exceção é a paleta de amostras do seletor de
// ícones (swatches.ts), que é cor escolhida pelo usuário, não cor de tema.
import { readdirSync, readFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { fileURLToPath } from 'url'
import { SKIP_DIRS, SKIP_FILES, BINARY } from './check-brand'

export const ALLOWED = new Set([
  'src/shared/theme/derive.ts',
  'src/shared/theme/builtins.ts',
  'src/shared/theme/swatches.ts'
])
const TEST = /\.(?:test|int\.test|spec)\.(?:ts|tsx)$/
const SOURCE = /\.(?:css|ts|tsx|js|mjs|html)$/
const HEX = /#([0-9a-fA-F]{3,8})(?![0-9a-fA-F])/g

// Comentário não é cor: some antes da busca. `//` só conta como comentário quando não vem logo
// depois de `:` (o `https://` de uma string não engole o resto da linha).
export const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

export const hasHexColor = (raw: string): boolean => {
  const text = stripComments(raw)
  for (const match of text.matchAll(HEX)) {
    const digits = match[1]
    if (digits.length !== 3 && digits.length !== 4 && digits.length !== 6 && digits.length !== 8) {
      continue
    }
    const after = text.slice((match.index ?? 0) + match[0].length)
    if (/^\s*\{/.test(after)) continue
    return true
  }
  return false
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full)
    } else if (entry.isFile() && !SKIP_FILES.has(entry.name) && !BINARY.test(entry.name)) {
      yield full
    }
  }
}

export function checkColors(root: string): { ok: boolean; offenders: string[] } {
  const offenders: string[] = []
  const src = join(root, 'src')
  let files: string[]
  try {
    files = [...walk(src)]
  } catch {
    return { ok: true, offenders }
  }
  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/')
    if (ALLOWED.has(rel) || TEST.test(rel) || !SOURCE.test(rel)) continue
    if (hasHexColor(readFileSync(file, 'utf8'))) offenders.push(rel)
  }
  offenders.sort()
  return { ok: offenders.length === 0, offenders }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ok, offenders } = checkColors(process.cwd())
  if (!ok) {
    console.error('hex fora de derive.ts e dos temas embutidos:')
    for (const file of offenders) console.error(`  ${file}`)
    process.exit(1)
  }
  console.log('check-colors: ok')
}
