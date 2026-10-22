import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppConfig } from '../../../shared/types'
import { toDkdeskTheme, type DkdeskPlan } from './plan'
import type { DkdeskSource } from './read'

export type DkdeskApplyResult = { themes_created: number; config_keys: string[]; skipped: string[] }

/**
 * Grava os temas `create` do plano e o patch de config. Cada tema entra com `flag: 'wx'`: nunca
 * sobrescreve (arquivo que apareceu depois do plano → `skipped`). `writeConfig` só roda com patch.
 */
export async function applyDkdesk(
  plan: DkdeskPlan,
  src: DkdeskSource,
  dst: { themesDir: string; writeConfig: (patch: Partial<AppConfig>) => Promise<void> }
): Promise<DkdeskApplyResult> {
  const skipped: string[] = []
  let created = 0
  const creates = plan.themes.filter((t) => t.action === 'create' && t.to !== null)
  if (creates.length) await mkdir(dst.themesDir, { recursive: true })
  for (const t of creates) {
    const theme = toDkdeskTheme(src.themes.find((s) => s.id === t.from)?.json, t.from)
    if (!theme) continue
    try {
      await writeFile(join(dst.themesDir, `${t.to}.json`), JSON.stringify(theme, null, 2) + '\n', {
        flag: 'wx'
      })
      created++
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      skipped.push(t.to as string)
    }
  }
  const patch: Partial<AppConfig> = { ...plan.config }
  // o tema escolhido não entrou: não aponta para um arquivo que não é o dele
  if (patch.theme !== undefined && skipped.includes(patch.theme)) delete patch.theme
  const config_keys = Object.keys(patch)
  if (config_keys.length) await dst.writeConfig(patch)
  return { themes_created: created, config_keys, skipped }
}
