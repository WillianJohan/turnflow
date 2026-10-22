import { join } from 'node:path'
import type { z } from 'zod'
import type { Db } from '../../core/db/open'
import type { DomainDeps } from '../../core/domain/context'
import { applyDkdesk } from '../../core/import/dkdesk/apply'
import { planDkdesk } from '../../core/import/dkdesk/plan'
import { readDkdesk } from '../../core/import/dkdesk/read'
import { importError } from '../../core/import/errors'
import { applyBrain, previewBrain } from '../../core/import/markdown'
import type { ImportOptions } from '../../core/import/markdown/plan'
import {
  normalizeEntries,
  readStatusMap,
  writeStatusMap,
  type StatusMapFile
} from '../../core/import/markdown/statusMap'
import type { Vault } from '../../core/key/vault'
import type { ImportWarning } from '../../shared/contracts'
import type { AppConfig } from '../../shared/types'
import * as I from '../../shared/ipc/import'
import { BUILTIN_THEMES, DEFAULT_CONFIG, readConfig } from '../appConfig'
import type { Register } from './handle'
import { toIpcDomainError } from './domain'

export type ImportIpcDeps = {
  vault: Vault
  domainFor: (db: Db) => DomainDeps
  configDir: string
  pickFolder: () => Promise<string | null>
  /** Grava `config.brainDir` (e a lateral herdada passa a listar dela). */
  setBrainDir: (dir: string) => Promise<void>
  /** Pasta de config do app legado (somente leitura). */
  legacyDir: () => string
  /** Grava o patch no `config.json` do app. */
  writeConfig: (patch: Partial<AppConfig>) => Promise<void>
  /** `themes/*.json` do app, crus (sem mesclar com o tema padrão). */
  readThemesRaw: () => Promise<{ id: string; json: unknown | null }[]>
  /** Log local: falha do que roda depois do commit do apply (mapa salvo, `brainDir`). */
  log?: (line: string) => void
}

const STATUS_MAP_FILE = 'import-status-map.json'

type Input = z.output<typeof I.importDryRun.input>

export function registerImportIpc(h: Register, deps: ImportIpcDeps): void {
  const mapFile = join(deps.configDir, STATUS_MAP_FILE)
  const log = deps.log ?? ((): void => undefined)

  /** Mapa salvo com os `status_edits` por cima; `edited` diz se há algo novo a gravar. */
  const optionsFor = async (
    input: Input
  ): Promise<{ o: ImportOptions; edited: boolean; newer: boolean }> => {
    const saved = await readStatusMap(mapFile)
    const edits = normalizeEntries(input.status_edits ?? {}).entries
    const status_map: StatusMapFile = {
      version: 1,
      entries: { ...saved.map.entries, ...edits }
    }
    return {
      o: {
        type_id: input.type_id,
        status_map,
        status_map_health: { problem: saved.problem, dropped: saved.dropped },
        take_markdown: input.take_markdown,
        workdirs: input.workdirs
      },
      edited: Object.keys(edits).length > 0,
      newer: saved.problem === 'newer_version'
    }
  }
  // vault.db() lança LOCKED fora de `ready`; todo erro sai pelo mesmo tradutor do domínio
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      throw toIpcDomainError(e)
    }
  }

  h(I.importDryRun, (input) =>
    guard(async () => {
      const d = deps.domainFor(deps.vault.db())
      const { o } = await optionsFor(input)
      return previewBrain(d, input.root, o)
    })
  )

  h(I.importApply, ({ token, ...input }) =>
    guard(async () => {
      const d = deps.domainFor(deps.vault.db())
      const { o, edited, newer } = await optionsFor(input)
      // o mapa não seria gravado depois do commit: recusa antes de importar
      if (edited && newer) throw importError('CONFLICT', 'status_map_newer_version')
      const report = await applyBrain(d, input.root, o, token)
      // Depois do commit, falha não vira erro do import (que já está no banco): vira aviso no
      // relatório (a tela mostra) e a mensagem crua vai pro log. Sem edits o arquivo do usuário
      // fica intocado (nem vai para `.bak`).
      const warn = (w: ImportWarning, what: string) => (e: unknown) => {
        report.warnings.push(w)
        log(`[import] ${what} not saved: ${message(e)}`)
      }
      if (edited)
        await writeStatusMap(mapFile, o.status_map).catch(
          warn('status_map_not_saved', 'status map')
        )
      await deps.setBrainDir(input.root).catch(warn('brain_dir_not_saved', 'brainDir'))
      return report
    })
  )

  // Temas e config do app legado. Prévia e apply refazem a leitura; o apply só escreve com o mesmo token.
  const legacyPlan = async (): Promise<{
    plan: ReturnType<typeof planDkdesk>
    src: Awaited<ReturnType<typeof readDkdesk>>
  }> => {
    const src = await readDkdesk(deps.legacyDir())
    const { config } = await readConfig(deps.configDir)
    const plan = planDkdesk(src, {
      config: { ...config },
      themes: await deps.readThemesRaw(),
      builtin: BUILTIN_THEMES,
      defaults: DEFAULT_CONFIG
    })
    return { plan, src }
  }

  h(I.importLegacyDryRun, () => guard(async () => (await legacyPlan()).plan))

  h(I.importLegacyApply, ({ token }) =>
    guard(async () => {
      const { plan, src } = await legacyPlan()
      if (plan.token !== token) throw importError('CONFLICT', 'preview_stale')
      return applyDkdesk(plan, src, {
        themesDir: join(deps.configDir, 'themes'),
        writeConfig: deps.writeConfig
      })
    })
  )

  h(I.importPickFolder, async () => ({ path: await deps.pickFolder() }))
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
