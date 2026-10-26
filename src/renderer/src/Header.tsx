import { useEffect, useState } from 'react'
import { SCREENS_COPY } from '../../shared/copy/screens'
import type { SessionRow } from '../../shared/contracts'
import { SESSION_COPY } from '../../shared/copy/session'
import type { HeaderCache, Task } from '../../shared/types'
import { Icon } from './Icon'
import { unwrap } from './ipc'

type Props = {
  task: Task
  alive: boolean
  onEnd(): void
  onSwitch(uuid: string): void
  extra?: React.ReactNode
}

const key = (id: string): string => `turnflow.hdr.${id}`
const isCollapsed = (id: string): boolean => {
  try {
    return localStorage.getItem(key(id)) === '0'
  } catch {
    return false
  }
}

export function Header({ task, alive, onEnd, onSwitch, extra }: Props): React.JSX.Element {
  const id = task.id
  const [h, setH] = useState<HeaderCache | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(() => !isCollapsed(id))
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)

  const refresh = (force: boolean): void => {
    setLoading(true)
    unwrap(window.turnflow.header({ id, force }))
      .then((x) => x && setH(x))
      .finally(() => setLoading(false))
  }

  // cache na hora; geração (lenta) só se README ou sessão mudaram
  useEffect(() => {
    unwrap(window.turnflow.headerCached({ id })).then((c) => c && setH(c))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca ao montar a aba, não é estado derivado
    refresh(false)
  }, [id])

  const toggle = (): void => {
    setOpen((o) => {
      try {
        localStorage.setItem(key(id), o ? '0' : '1')
      } catch {
        // sem storage
      }
      return !o
    })
  }

  const hdr = h?.header
  return (
    <div className="hdr">
      <div className="th">
        <button
          className="hdr-toggle"
          onClick={toggle}
          title={SCREENS_COPY.brainHeader.toggle(open)}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="th-title">
          <b>{id}</b> — {task.title}
        </span>
        {!open && hdr?.next && <span className="th-next">→ {hdr.next}</span>}
        <span className="th-actions">
          {extra}
          <span className="menu-wrap">
            <button
              onClick={() => {
                if (sessions) {
                  setSessions(null)
                  return
                }
                void unwrap(window.turnflow.taskGet({ id })).then(async (row) => {
                  if (!row) return
                  const list = await unwrap(window.turnflow.sessionList({ task_id: row.id }))
                  if (list) setSessions(list)
                })
              }}
            >
              {SCREENS_COPY.brainHeader.sessions} <Icon name="chevron" size={12} />
            </button>
            {sessions && (
              <ul className="menu" onMouseLeave={() => setSessions(null)}>
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      disabled={s.ended_at === null || !s.external_id}
                      title={
                        s.ended_at === null ? SESSION_COPY.sessionOpen : (s.external_id ?? s.id)
                      }
                      onClick={() => {
                        setSessions(null)
                        onSwitch(s.id)
                      }}
                    >
                      {s.ended_at === null ? '● ' : ''}
                      {s.started_at} — {s.label || s.external_id?.slice(0, 8) || s.id.slice(0, 8)}
                    </button>
                  </li>
                ))}
                {!sessions.length && (
                  <li className="empty">{SCREENS_COPY.brainHeader.noSessions}</li>
                )}
              </ul>
            )}
          </span>
          <button
            onClick={() => refresh(true)}
            disabled={loading}
            title={SCREENS_COPY.brainHeader.regenerate}
          >
            <Icon name="refresh" size={13} />
          </button>
          {alive && (
            <button onClick={onEnd} title={SCREENS_COPY.brainHeader.endHint}>
              {SCREENS_COPY.brainHeader.end}
            </button>
          )}
        </span>
      </div>
      {open && (
        <div className="hdr-body">
          {hdr?.what ? (
            <>
              <p>
                <span className="k">{SCREENS_COPY.brainHeader.what}</span>
                {hdr.what}
              </p>
              <p>
                <span className="k">{SCREENS_COPY.brainHeader.where}</span>
                {hdr.where}
              </p>
              <p>
                <span className="k">{SCREENS_COPY.brainHeader.next}</span>
                {hdr.next}
              </p>
            </>
          ) : (
            !loading && !h?.error && <p className="dim">{SCREENS_COPY.brainHeader.empty}</p>
          )}
          {loading && <p className="dim">{SCREENS_COPY.brainHeader.loading}</p>}
          {!loading && h?.error && <p className="hdr-err">{h.error}</p>}
        </div>
      )}
    </div>
  )
}
