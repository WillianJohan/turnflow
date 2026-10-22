import { z } from 'zod'
import { ImportField, ImportPreview, ImportReport, Limits, StatusTargetZ } from '../contracts'
import { DOMAIN_COPY } from '../copy/domain'
import { IMPORT_COPY } from '../copy/import'
import { isAbsolutePath } from '../pathSyntax'
import { Id, NoInput } from './common'
import { defineChannel } from './define'

// Canais do import do brain em markdown (E4.1). A prévia e o apply leem a pasta de novo a cada
// chamada; o apply só escreve se o `token` ainda é o da prévia (senão `CONFLICT preview_stale`).

/** Teto de itens das escolhas: o mesmo `MAX_TASKS` do scan. */
const MAX_ITEMS = 5_000
const Key = z.string().min(1).max(Limits.title)

const Root = z
  .string()
  .max(Limits.workdir)
  .refine(isAbsolutePath, IMPORT_COPY.errors.import_root_invalid)

/** Diferente do `Workdir` da task, aqui `''` (= limpar) não vale: só absoluta (`''` não é). */
const ImportWorkdir = z
  .string()
  .max(Limits.workdir)
  .refine(isAbsolutePath, DOMAIN_COPY.errors.workdir_relative)

const bounded = <T extends z.ZodTypeAny>(v: T): z.ZodEffects<z.ZodRecord<z.ZodString, T>> =>
  z.record(z.string().max(Limits.title), v).refine((o) => Object.keys(o).length <= MAX_ITEMS)

/**
 * Escolhas do usuário. Todas mudam o plano e, com ele, o `token`: a tela manda as MESMAS escolhas
 * na prévia e no apply (refaz o dry-run a cada mudança), senão o apply sai `preview_stale`.
 * - `status_edits`: status (chave da prévia) → alvo; vale por cima do mapa salvo e só é gravado
 *   no `import-status-map.json` quando o apply dá certo.
 * - `take_markdown`: conflitos resolvidos com o valor do markdown.
 * - `workdirs`: pasta de trabalho por key (só no create ou se a task está sem).
 */
const Choices = {
  type_id: Id.optional(),
  status_edits: bounded(StatusTargetZ).optional(),
  take_markdown: z
    .array(z.object({ key: Key, field: ImportField }).strict())
    .max(MAX_ITEMS)
    .optional(),
  workdirs: bounded(ImportWorkdir).optional()
}

export const importDryRun = defineChannel(
  'import.dryRun',
  z.object({ root: Root, ...Choices }).strict(),
  ImportPreview
)
export const importApply = defineChannel(
  'import.apply',
  z.object({ root: Root, ...Choices, token: z.string().min(1).max(256) }).strict(),
  ImportReport
)
/** Diálogo nativo de pasta; `null` = cancelado. */
export const importPickFolder = defineChannel(
  'import.pickFolder',
  NoInput,
  z.object({ path: z.string().nullable() })
)

// Migração dos temas e da config do app legado (E4.3): prévia lê a pasta de novo a cada chamada e o
// apply só escreve se o `token` ainda é o da prévia (senão `CONFLICT preview_stale`).
const Short = z.string().max(256)
export const LegacyPlanZ = z
  .object({
    token: z.string().min(1).max(256),
    themes: z
      .array(
        z
          .object({
            from: Short,
            to: Short.nullable(),
            name: Short,
            action: z.enum(['create', 'skip_same', 'skip_builtin', 'skip_invalid'])
          })
          .strict()
      )
      .max(500),
    config: z
      .object({
        theme: Short,
        draftMode: z.boolean(),
        notifications: z.boolean(),
        fontSize: z.number(),
        termFont: Short,
        appFont: Short,
        appFontSize: z.number()
      })
      .partial()
      .strict(),
    ignored_keys: z.array(Short).max(500)
  })
  .strict()
export const LegacyApplyResultZ = z
  .object({
    themes_created: z.number().int().min(0),
    config_keys: z.array(Short).max(50),
    skipped: z.array(Short).max(500)
  })
  .strict()

export const importLegacyDryRun = defineChannel('import.legacyDryRun', NoInput, LegacyPlanZ)
export const importLegacyApply = defineChannel(
  'import.legacyApply',
  z.object({ token: z.string().min(1).max(256) }).strict(),
  LegacyApplyResultZ
)

export type LegacyPlan = z.output<typeof LegacyPlanZ>
export type LegacyApplyResult = z.output<typeof LegacyApplyResultZ>
export type ImportDryRunInput = z.input<typeof importDryRun.input>
export type ImportApplyInput = z.input<typeof importApply.input>
