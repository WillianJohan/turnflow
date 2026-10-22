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

export type ImportDryRunInput = z.input<typeof importDryRun.input>
export type ImportApplyInput = z.input<typeof importApply.input>
