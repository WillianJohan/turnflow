import type { TaskRow } from '../../shared/contracts'
import { SHELL_COPY } from '../../shared/copy/shell'
import { rowMotive } from './attentionFields'

export type HomeColumn = {
  id: 'sua_vez' | 'pendente' | 'encaminhado'
  label: string
  rows: TaskRow[]
  stalled: number
  /** Paradas em projetos (só no Pendente): a linha "N stalled" abre esta lista. */
  stalledRows: TaskRow[]
}

const LABELS = SHELL_COPY.attention.sections

/** Três colunas de atenção. Paradas em projeto não entram nas colunas; a contagem fica no Pendente. */
export function homeColumns(rows: TaskRow[]): HomeColumn[] {
  const stalled = rows.filter((row) => row.group === 'fila_projeto')
  return (['sua_vez', 'pendente', 'encaminhado'] as const).map((id) => ({
    id,
    label: LABELS[id],
    rows: rows.filter((row) => row.group === id),
    stalled: id === 'pendente' ? stalled.length : 0,
    stalledRows: id === 'pendente' ? stalled : []
  }))
}

export function stalledLabel(n: number): string | null {
  if (n <= 0) return null
  return SHELL_COPY.homeView.stalled(n)
}

/** Painel estreito esconde key e motivo. A tag Bloq. fica. */
export function homeLine(
  row: TaskRow,
  narrow: boolean
): { title: string; key: string | null; motive: string | null; tag: string | null } {
  const motive = rowMotive(row)
  const blocked = motive === SHELL_COPY.attention.blocked
  return {
    title: row.title,
    key: narrow ? null : row.key,
    motive: narrow || blocked ? null : motive,
    tag: blocked ? SHELL_COPY.attention.blocked : null
  }
}

const DAY = 86_400_000
/** Janelas das Concluídas, em dias; depois da última vêm todas. */
export const DONE_WINDOWS = [30, 90, 365] as const

/** `done_since` da janela `n` (0 = 30 dias), ou `null` = todas. */
export function doneSince(n: number, now: number): string | null {
  const days = DONE_WINDOWS[n]
  return days === undefined ? null : new Date(now - days * DAY).toISOString()
}
