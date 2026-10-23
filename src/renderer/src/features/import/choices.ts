import type { z } from 'zod'
import type {
  ImportConflict,
  ImportPreview,
  StatusRoleZ,
  StatusTargetZ
} from '../../../../shared/contracts'
import type { ImportApplyInput, ImportDryRunInput } from '../../../../shared/ipc/import'

export type StatusTarget = z.infer<typeof StatusTargetZ>
type StatusRole = z.infer<typeof StatusRoleZ>
type Field = ImportConflict['field']

/**
 * Escolhas do usuário na tela de import. Todas mudam o plano (e o `token`), então a prévia e o
 * apply recebem exatamente as mesmas: a tela refaz a prévia a cada mudança.
 */
export type ImportChoices = {
  type_id?: string
  status_edits: Record<string, StatusTarget>
  /** Conflitos resolvidos com o markdown, como `'KEY|field'`. */
  take_markdown: Set<string>
  workdirs: Record<string, string>
}

export const emptyChoices = (): ImportChoices => ({
  status_edits: {},
  take_markdown: new Set(),
  workdirs: {}
})

export const takeKey = (key: string, field: Field): string => `${key}|${field}`

export function previewInput(root: string, c: ImportChoices): ImportDryRunInput {
  return {
    root,
    ...(c.type_id ? { type_id: c.type_id } : {}),
    status_edits: { ...c.status_edits },
    // a key não tem `|` (KEY_RE), então o último `|` separa o campo
    take_markdown: [...c.take_markdown].map((s) => {
      const i = s.lastIndexOf('|')
      return { key: s.slice(0, i), field: s.slice(i + 1) as Field }
    }),
    workdirs: { ...c.workdirs }
  }
}

export function applyInput(root: string, token: string, c: ImportChoices): ImportApplyInput {
  return { ...previewInput(root, c), token }
}

export const withStatus = (c: ImportChoices, key: string, t: StatusTarget): ImportChoices => ({
  ...c,
  status_edits: { ...c.status_edits, [key]: t }
})

export function withTake(
  c: ImportChoices,
  key: string,
  field: Field,
  take: boolean
): ImportChoices {
  const s = new Set(c.take_markdown)
  if (take) s.add(takeKey(key, field))
  else s.delete(takeKey(key, field))
  return { ...c, take_markdown: s }
}

export function withWorkdir(c: ImportChoices, key: string, dir: string | null): ImportChoices {
  const workdirs = { ...c.workdirs }
  if (dir === null) delete workdirs[key]
  else workdirs[key] = dir
  return { ...c, workdirs }
}

const ROLES: readonly StatusRole[] = ['first', 'working', 'review', 'final', 'blocked']

/** Valor do `<select>` de status: `stage:<nome>`, `role:<papel>` ou `''` (sem mapeamento). */
export function targetValue(t: StatusTarget | null): string {
  if (!t) return ''
  return 'stage' in t ? `stage:${t.stage}` : `role:${t.role}`
}

export function parseTarget(v: string): StatusTarget | null {
  if (v.startsWith('stage:') && v.length > 6) return { stage: v.slice(6) }
  const role = v.slice(5) as StatusRole
  if (v.startsWith('role:') && ROLES.includes(role)) return { role }
  return null
}

/** Conflitos conhecidos pela tela, por `'KEY|field'`. */
export type KnownConflicts = Record<string, ImportConflict>

const FIELD_ORDER: readonly Field[] = ['title', 'description', 'project', 'stage']

/**
 * Reconcilia os conflitos conhecidos com uma prévia nova (feita com `take`). Os da prévia entram
 * com os valores dela. Um conflito resolvido com o markdown some da prévia (o core já não o vê
 * como conflito): fica enquanto a task segue na prévia escrevendo aquele campo, e sai quando a
 * task some, fica inválida ou o markdown converge com o app.
 */
export function reconcileConflicts(
  known: KnownConflicts,
  p: ImportPreview,
  take: Set<string>
): KnownConflicts {
  const rows = new Map(p.tasks.map((t) => [t.key, t]))
  const out: KnownConflicts = {}
  for (const [k, c] of Object.entries(known)) {
    const t = rows.get(c.key)
    if (take.has(k) && t && t.action !== 'invalid' && t.fields.includes(c.field)) out[k] = c
  }
  for (const t of p.tasks) for (const c of t.conflicts) out[takeKey(c.key, c.field)] = c
  return out
}

/** Conflitos a mostrar numa task, em ordem fixa de campo (trocar a escolha não reordena). */
export function conflictsFor(
  t: ImportPreview['tasks'][number],
  known: KnownConflicts
): ImportConflict[] {
  const byField = new Map(t.conflicts.map((c) => [c.field, c]))
  for (const c of Object.values(known))
    if (c.key === t.key && !byField.has(c.field)) byField.set(c.field, c)
  return FIELD_ORDER.flatMap((f) => byField.get(f) ?? [])
}
