import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { parseUi, UiFileZ, type UiFile } from '../shared/uiFile'

export async function readUi(dir: string): Promise<UiFile | null> {
  try {
    return parseUi(await readFile(join(dir, 'ui.json'), 'utf8'))
  } catch {
    return null
  }
}

export async function writeUi(dir: string, file: UiFile): Promise<void> {
  const parsed = UiFileZ.parse(file)
  await writeFile(join(dir, 'ui.json'), JSON.stringify(parsed, null, 2) + '\n')
}
