// Cabeçalho, registro e menu da visão da task (E6.4). Textos em inglês até o E6.9.
import { SHELL_COPY } from '../../shared/copy/shell'

export const TOAST_MS = 8000

const textOf = (value: string | null): string | null => {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export type HeaderLine = { label: string; text: string; placeholder: boolean }

export type HeaderFace = { lines: [HeaderLine, HeaderLine]; edit: string }

export function headerFace(input: {
  sum_what: string | null
  sum_where: string | null
  sum_next: string | null
  checkpoints: { at: string; text: string }[]
}): HeaderFace {
  const nextText = textOf(input.sum_next)
  const what = textOf(input.sum_what)
  const where = textOf(input.sum_where)
  const next: HeaderLine = {
    label: SHELL_COPY.header.next,
    text: nextText ?? '',
    placeholder: nextText === null
  }
  const hasSummary = what !== null || where !== null || nextText !== null
  if (!hasSummary) {
    const last = [...input.checkpoints].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0]
    return {
      lines: [
        last
          ? { label: SHELL_COPY.header.lastRecord, text: last.text, placeholder: true }
          : { label: SHELL_COPY.header.noSummary, text: '', placeholder: true },
        next
      ],
      edit: SHELL_COPY.header.edit
    }
  }
  const stopped = what ?? where ?? ''
  return {
    lines: [
      { label: SHELL_COPY.header.stoppedAt, text: stopped, placeholder: false },
      { ...next, placeholder: false }
    ],
    edit: SHELL_COPY.header.edit
  }
}

export type TimelineItem = {
  kind: 'checkpoint' | 'session'
  id: string
  at: string
  text: string
  resumable: boolean
}

export function timelineItems(input: {
  checkpoints: { id: string; at: string; text: string }[]
  sessions: {
    id: string
    tool: string
    external_id: string | null
    started_at: string
    ended_at: string | null
    label: string | null
  }[]
}): TimelineItem[] {
  const marks: TimelineItem[] = [
    ...input.checkpoints.map((row) => ({
      kind: 'checkpoint' as const,
      id: row.id,
      at: row.at,
      text: row.text,
      resumable: false
    })),
    ...input.sessions.map((row) => ({
      kind: 'session' as const,
      id: row.id,
      at: row.started_at,
      text: row.label?.trim() || row.tool,
      resumable: row.ended_at !== null && row.external_id !== null && row.external_id !== ''
    }))
  ]
  return marks.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

export type MenuId =
  'record' | 'sessions' | 'workdir' | 'previous-stage' | 'move' | 'block' | 'unblock' | 'close'

export type MenuItem = { id: MenuId; label: string; undo: boolean }

const MENU: Record<MenuId, MenuItem> = {
  record: { id: 'record', label: SHELL_COPY.menu.record, undo: false },
  sessions: { id: 'sessions', label: SHELL_COPY.menu.sessions, undo: false },
  workdir: { id: 'workdir', label: SHELL_COPY.menu.workdir, undo: false },
  'previous-stage': {
    id: 'previous-stage',
    label: SHELL_COPY.menu['previous-stage'],
    undo: true
  },
  move: { id: 'move', label: SHELL_COPY.menu.move, undo: true },
  block: { id: 'block', label: SHELL_COPY.menu.block, undo: true },
  unblock: { id: 'unblock', label: SHELL_COPY.menu.unblock, undo: true },
  close: { id: 'close', label: SHELL_COPY.menu.close, undo: true }
}

export function menuItems(blocked: boolean): MenuItem[] {
  const ids: MenuId[] = [
    'record',
    'sessions',
    'workdir',
    'previous-stage',
    'move',
    blocked ? 'unblock' : 'block',
    'close'
  ]
  return ids.map((id) => MENU[id])
}

export function previousStageId(
  stages: { id: string; position: number }[],
  currentId: string
): string | null {
  const current = stages.find((stage) => stage.id === currentId)
  if (!current) return null
  const previous = stages
    .filter((stage) => stage.position < current.position)
    .sort((a, b) => b.position - a.position)[0]
  return previous?.id ?? null
}

export function closeNeedsConfirm(state: string | undefined): boolean {
  return state === 'working'
}

export function undoToast(
  activityId: string | null,
  now: number
): { activityId: string; until: number } | null {
  if (!activityId) return null
  return { activityId, until: now + TOAST_MS }
}

export const CLOSE_WHILE_WORKING = SHELL_COPY.header.closeWhileWorking

/** Par sugerido para a etapa atual. Sem sugestão, o adopt não tem para onde ir. */
export function suggestedMapping(
  preview: { from: { id: string }; to_stage_id: string | null }[],
  stageId: string
): Record<string, string> | null {
  const row = preview.find((item) => item.from.id === stageId)
  if (!row?.to_stage_id) return null
  return { [stageId]: row.to_stage_id }
}

export function summaryPatch(
  what: string,
  next: string
): { sum_what: string | null; sum_next: string | null } {
  const clean = (value: string): string | null => {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  return { sum_what: clean(what), sum_next: clean(next) }
}
