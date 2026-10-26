import { readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { cleanLayout, parseUi, UiFileZ, type UiFile } from '../shared/uiFile'

/**
 * `null` quando não há arquivo ou ele não é desta versão. Arquivo que existe e não serve (versão
 * futura, quebrado) vira `ui.json.<ms>.bak` antes: a próxima gravação começaria do padrão e
 * apagaria o layout do usuário sem volta.
 */
export async function readUi(dir: string): Promise<UiFile | null> {
  const path = join(dir, 'ui.json')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }
  const parsed = parseUi(raw)
  if (parsed) return parsed
  await rename(path, join(dir, `ui.json.${Date.now()}.bak`)).catch(() => undefined)
  return null
}

/** Peso de painel inválido cai fora antes do schema: um campo ruim não trava todas as gravações. */
export async function writeUi(dir: string, file: UiFile): Promise<void> {
  const parsed = UiFileZ.parse({ ...file, layout: cleanLayout(file.layout) })
  await writeFile(join(dir, 'ui.json'), JSON.stringify(parsed, null, 2) + '\n')
}
