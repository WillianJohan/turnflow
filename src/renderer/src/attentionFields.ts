import type { Reason, SessionState, TaskRow } from '../../shared/contracts'
import type { Density } from '../../shared/uiFile'

export type AttentionFields = {
  key: string
  title: string
  state: SessionState | null
  stage: string | null
  motive: string | null
  next: string | null
  age: string | null
}

const MOTIVE: Record<Reason, string> = {
  sessao_aguardando: 'AI waiting',
  voltou: 'Back',
  desbloqueada: 'Unblocked',
  atribuida: 'Assigned',
  bloqueada: 'Blocked',
  aguardando_outro: 'Waiting on someone',
  parada_no_projeto: 'Stalled in a project'
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** Lista fechada: now, Nm, Nh, Nd, Nw. */
export function relativeAge(iso: string, now: number): string {
  const delta = now - Date.parse(iso)
  if (!Number.isFinite(delta) || delta < MIN) return 'now'
  if (delta < HOUR) return `${Math.floor(delta / MIN)}m`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`
  if (delta < WEEK) return `${Math.floor(delta / DAY)}d`
  return `${Math.floor(delta / WEEK)}w`
}

export function rowMotive(row: TaskRow): string | null {
  if (row.blocked_reason !== null) return 'Bloq.'
  return row.reason ? MOTIVE[row.reason.kind] : null
}

export function attentionFields(row: TaskRow, density: Density, now: number): AttentionFields {
  const since = row.reason?.since ?? row.touched_at
  return {
    key: row.key,
    title: row.title,
    state: row.session?.state ?? null,
    stage: density === 'compact' ? null : row.stage.short_name,
    motive: density === 'compact' ? null : rowMotive(row),
    next: density === 'wide' ? row.sum_next : null,
    age: density === 'wide' ? relativeAge(since, now) : null
  }
}

export const ATTENTION_SECTIONS = [
  ['sua_vez', 'Your turn'],
  ['pendente', 'Pending'],
  ['encaminhado', 'Forwarded']
] as const

/** Mantém a ordem do core. `fila_projeto` e `concluida` ficam fora destas seções. */
export function attentionSections(
  rows: TaskRow[]
): { id: string; label: string; rows: TaskRow[] }[] {
  return ATTENTION_SECTIONS.map(([id, label]) => ({
    id,
    label,
    rows: rows.filter((row) => row.group === id)
  })).filter((section) => section.rows.length > 0)
}
