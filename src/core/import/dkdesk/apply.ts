import { link, mkdir, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppConfig } from '../../../shared/types'
import { toDkdeskTheme, type DkdeskPlan } from './plan'
import type { DkdeskSource } from './read'

export type DkdeskApplyResult = { themes_created: number; config_keys: string[]; skipped: string[] }

/** E/S do tema: injetável para o teste simular falha no meio da escrita. */
export type ThemeIo = {
  open(
    file: string,
    flags: string,
    mode: number
  ): Promise<{
    writeFile(data: string): Promise<void>
    sync(): Promise<void>
    close(): Promise<void>
  }>
  link(existing: string, target: string): Promise<void>
  unlink(file: string): Promise<void>
}
export const nodeThemeIo: ThemeIo = { open, link, unlink }

const THEME_MODE = 0o644

/** Escreve num temporário, fsync e publica com `link` (nunca sobrescreve): o arquivo final só existe
 * completo. `false` = o destino já existia. Qualquer erro apaga o temporário. */
async function publish(io: ThemeIo, dir: string, id: string, data: string): Promise<boolean> {
  const tmp = join(dir, `.${id}.json.partial`)
  try {
    const h = await io.open(tmp, 'w', THEME_MODE)
    try {
      await h.writeFile(data)
      await h.sync()
    } finally {
      await h.close()
    }
    await io.link(tmp, join(dir, `${id}.json`))
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw e
  } finally {
    await io.unlink(tmp).catch(() => undefined)
  }
}

/**
 * Grava os temas `create` do plano e o patch de config. Cada tema entra por temporário + `link`: nunca
 * sobrescreve (arquivo que apareceu depois do plano → `skipped`). `writeConfig` só roda com patch.
 */
export async function applyDkdesk(
  plan: DkdeskPlan,
  src: DkdeskSource,
  dst: {
    themesDir: string
    writeConfig: (patch: Partial<AppConfig>) => Promise<void>
    io?: ThemeIo
  }
): Promise<DkdeskApplyResult> {
  const skipped: string[] = []
  let created = 0
  const creates = plan.themes.filter((t) => t.action === 'create' && t.to !== null)
  if (creates.length) await mkdir(dst.themesDir, { recursive: true })
  for (const t of creates) {
    const theme = toDkdeskTheme(src.themes.find((s) => s.id === t.from)?.json, t.from)
    if (!theme) continue
    const data = JSON.stringify(theme, null, 2) + '\n'
    if (await publish(dst.io ?? nodeThemeIo, dst.themesDir, t.to as string, data)) created++
    else skipped.push(t.to as string)
  }
  const patch: Partial<AppConfig> = { ...plan.config }
  // o tema escolhido não entrou: não aponta para um arquivo que não é o dele
  if (patch.theme !== undefined && skipped.includes(patch.theme)) delete patch.theme
  const config_keys = Object.keys(patch)
  if (config_keys.length) await dst.writeConfig(patch)
  return { themes_created: created, config_keys, skipped }
}
