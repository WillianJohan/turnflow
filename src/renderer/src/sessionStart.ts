import type { SessionState, SessionTool } from '../../shared/contracts'
import { SESSION_COPY } from '../../shared/copy/session'

type Api = Pick<Window['turnflow'], 'ptySpawn' | 'sessionPickWorkdir' | 'taskSetWorkdir' | 'onExit'>
type Spawned = Awaited<ReturnType<Window['turnflow']['ptySpawn']>>

const reasonOf = (details: unknown): unknown =>
  details && typeof details === 'object' && 'reason' in details ? details.reason : undefined

const why = (details: unknown): { reason?: string } => {
  const reason = reasonOf(details)
  return typeof reason === 'string' ? { reason } : {}
}

/** Teto da espera pelo `pty:exit`: passa do SIGKILL do pool (3 s), caso o evento se perca. */
export const BUSY_WAIT_MS = 4000

/**
 * `pty_busy` = o processo velho do mesmo pty_id ainda está saindo. Espera o `pty:exit` dele
 * (ou o teto) e tenta de novo, poucas vezes (Decisão 30). Escuta antes do 1º spawn para não
 * perder um exit que chegue entre a resposta e a espera.
 */
export async function spawnWhenFree(
  spawn: () => Promise<Spawned>,
  onExit: Window['turnflow']['onExit'],
  ptyId: string,
  o: { tries?: number; waitMs?: number } = {}
): Promise<Spawned> {
  let gone = false
  let wake: (() => void) | null = null
  const off = onExit((id) => {
    if (id !== ptyId) return
    gone = true
    wake?.()
  })
  try {
    let r = await spawn()
    for (let n = 0; n < (o.tries ?? 3); n++) {
      if (r.ok || reasonOf(r.error.details) !== 'pty_busy') return r
      if (!gone)
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, o.waitMs ?? BUSY_WAIT_MS)
          wake = () => {
            clearTimeout(t)
            resolve()
          }
        })
      gone = false
      wake = null
      r = await spawn()
    }
    return r
  } finally {
    off()
  }
}

export async function startSessionFlow(
  api: Api,
  i: {
    pty_id: string
    task: string | null
    task_id?: string
    tool: SessionTool
    resume?: string
    cols: number
    rows: number
  }
): Promise<
  | { ok: true; session_id: string | null }
  | { ok: false; cancelled: true }
  | { ok: false; message: string; reason?: string }
> {
  const spawn = (): Promise<Spawned> =>
    spawnWhenFree(
      () =>
        api.ptySpawn({
          kind: 'agent',
          pty_id: i.pty_id,
          tool: i.tool,
          task: i.task,
          cols: i.cols,
          rows: i.rows,
          ...(i.resume ? { resume: i.resume } : {})
        }),
      api.onExit,
      i.pty_id
    )
  const first = await spawn()
  if (first.ok) return { ok: true, session_id: first.data.session_id }
  if (reasonOf(first.error.details) !== 'workdir_required' || !i.task_id)
    return { ok: false, message: first.error.message, ...why(first.error.details) }
  const picked = await api.sessionPickWorkdir()
  if (!picked.ok) return { ok: false, message: picked.error.message }
  if (picked.data === null) return { ok: false, cancelled: true }
  const saved = await api.taskSetWorkdir({ id: i.task_id, workdir: picked.data })
  if (!saved.ok) return { ok: false, message: saved.error.message }
  const second = await spawn()
  if (second.ok) return { ok: true, session_id: second.data.session_id }
  return { ok: false, message: second.error.message, ...why(second.error.details) }
}

/** Adota a sessão atual do pty: a que o spawn devolveu some se uma fusão a absorver. */
export async function adoptFromPty(
  api: Pick<Window['turnflow'], 'sessionOfPty' | 'sessionAdopt'>,
  ptyId: string,
  task: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const cur = await api.sessionOfPty({ pty_id: ptyId })
  if (!cur.ok) return { ok: false, message: cur.error.message }
  if (!cur.data.session_id) return { ok: false, message: SESSION_COPY.noSession }
  const done = await api.sessionAdopt({ session_id: cur.data.session_id, task })
  return done.ok ? { ok: true } : { ok: false, message: done.error.message }
}

export function needsEndConfirm(state: SessionState | undefined): boolean {
  return state === 'working'
}
