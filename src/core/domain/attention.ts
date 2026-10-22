import type { Group, Reason, SessionState, TurnReason } from '../../shared/contracts'

export const DAY_MS = 86_400_000
const FADE_AFTER_MS = 3 * DAY_MS
const EPOCH_MAX = 9_999_999_999_999

export type AttTask = {
  id: string
  done_at: string | null
  turn_reason: TurnReason | null
  turn_at: string | null
  blocked_reason: string | null
  blocked_at: string | null
  project_id: string | null
  touched_at: string
}

export type AttSession = { state: SessionState; state_at: string; ended_at: string | null }

export type Attention = {
  group: Group
  reason: { kind: Reason; since: string } | null
  faded: boolean
  sort_key: string
}

const URGENCY: Record<SessionState, number> = { waiting: 0, working: 1, idle: 2, unknown: 3 }

/** Sessão viva mais urgente: waiting > working > idle > unknown; empate pelo state_at mais antigo. */
export function pickSession<T extends AttSession>(s: T[]): T | null {
  let best: T | null = null
  for (const cur of s) {
    if (cur.ended_at !== null) continue
    if (
      best === null ||
      URGENCY[cur.state] < URGENCY[best.state] ||
      (cur.state === best.state && Date.parse(cur.state_at) < Date.parse(best.state_at))
    ) {
      best = cur
    }
  }
  return best
}

const e13 = (iso: string): string => String(Date.parse(iso)).padStart(13, '0')
const inv13 = (iso: string): string => String(EPOCH_MAX - Date.parse(iso)).padStart(13, '0')
const older = (a: string, b: string): string => (Date.parse(a) <= Date.parse(b) ? a : b)

export function attention(
  task: AttTask,
  stage: { waits_other: boolean },
  sessions: AttSession[],
  now: Date,
  rank?: string | null
): Attention {
  const id = task.id
  const done = (
    group: Group,
    sort_key: string,
    reason: Attention['reason'] = null,
    faded = false
  ): Attention => ({
    group,
    reason,
    faded,
    sort_key
  })

  if (task.done_at) return done('concluida', `${inv13(task.done_at)}|${id}`)

  const s = pickSession(sessions)
  if (s?.state === 'waiting') {
    const since = task.turn_at ? older(s.state_at, task.turn_at) : s.state_at
    return done('sua_vez', `${e13(since)}|${id}`, { kind: 'sessao_aguardando', since })
  }
  if (task.turn_reason) {
    const since = task.turn_at ?? task.touched_at
    return done('sua_vez', `${e13(since)}|${id}`, { kind: task.turn_reason, since })
  }
  if (task.blocked_reason) {
    const since = task.blocked_at ?? task.touched_at
    return done('encaminhado', `0|${e13(since)}|${id}`, { kind: 'bloqueada', since })
  }
  if (stage.waits_other) {
    const since = task.touched_at
    return done('encaminhado', `1|${e13(since)}|${id}`, { kind: 'aguardando_outro', since })
  }

  const stale = now.getTime() - Date.parse(task.touched_at) > FADE_AFTER_MS
  if (task.project_id && stale && s?.state !== 'working') {
    return done('fila_projeto', `${task.project_id}|${rank ?? '~'}|${id}`, {
      kind: 'parada_no_projeto',
      since: task.touched_at
    })
  }
  return done('pendente', `${inv13(task.touched_at)}|${id}`, null, stale)
}
