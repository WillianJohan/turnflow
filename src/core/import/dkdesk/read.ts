import { basename, join } from 'node:path'
import { importError } from '../errors'
import { nodeBrainFs, type BrainFs } from '../markdown/scan'
import { LEGACY_DIR_NAME } from '../../../shared/paths'

// Leitor do app legado: abre SÓ `config.json` e `themes/*.json` (nunca Local Storage, prefs de janela
// ou qualquer outra coisa da pasta). Somente leitura.

export type DkdeskSource = {
  config: Record<string, unknown> | null
  themes: { id: string; json: unknown | null }[]
}

const MAX_FILE_BYTES = 256 * 1024
const MAX_THEMES = 200

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const code = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | null)?.code

/** JSON do arquivo, ou `null` se faltar, passar do teto ou não parsear (texto cortado não parseia). */
async function readJson(fs: Pick<BrainFs, 'readFile'>, file: string): Promise<unknown | null> {
  try {
    return JSON.parse((await fs.readFile(file, MAX_FILE_BYTES + 1)).toString('utf8')) as unknown
  } catch {
    return null
  }
}

export async function readDkdesk(
  dir: string,
  fs: Pick<BrainFs, 'readdir' | 'readFile'> = nodeBrainFs
): Promise<DkdeskSource> {
  try {
    await fs.readdir(dir)
  } catch (e) {
    if (code(e) === 'ENOENT' || code(e) === 'ENOTDIR')
      throw importError('NOT_FOUND', 'legacy_not_found', { name: LEGACY_DIR_NAME })
    throw e
  }
  const config = await readJson(fs, join(dir, 'config.json'))
  const entries = await fs.readdir(join(dir, 'themes')).catch(() => [])
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort()
    .slice(0, MAX_THEMES)
  const themes: DkdeskSource['themes'] = []
  for (const f of files)
    themes.push({ id: basename(f, '.json'), json: await readJson(fs, join(dir, 'themes', f)) })
  return { config: isRecord(config) ? config : null, themes }
}
