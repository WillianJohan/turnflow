import type { SessionState } from '../../shared/contracts'

type SessionTool = 'claude-code' | 'codex' | 'cursor' | 'other'

type Api = Pick<Window['turnflow'], 'ptySpawn' | 'sessionPickWorkdir' | 'taskSetWorkdir'>

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
  | { ok: false; message: string }
> {
  const spawn = (): ReturnType<Api['ptySpawn']> =>
    api.ptySpawn({
      kind: 'agent',
      pty_id: i.pty_id,
      tool: i.tool,
      task: i.task,
      cols: i.cols,
      rows: i.rows,
      ...(i.resume ? { resume: i.resume } : {})
    })
  const first = await spawn()
  if (first.ok) return { ok: true, session_id: first.data.session_id }
  const details = first.error.details
  const reason =
    details && typeof details === 'object' && 'reason' in details ? details.reason : undefined
  if (reason !== 'workdir_required' || !i.task_id)
    return { ok: false, message: first.error.message }
  const picked = await api.sessionPickWorkdir()
  if (!picked.ok) return { ok: false, message: picked.error.message }
  if (picked.data === null) return { ok: false, cancelled: true }
  const saved = await api.taskSetWorkdir({ id: i.task_id, workdir: picked.data })
  if (!saved.ok) return { ok: false, message: saved.error.message }
  const second = await spawn()
  if (second.ok) return { ok: true, session_id: second.data.session_id }
  return { ok: false, message: second.error.message }
}

export function needsEndConfirm(state: SessionState | undefined): boolean {
  return state === 'working'
}
