import { useEffect, useRef, useState } from 'react'
import type { SessionRow } from '../../shared/contracts'
import { SESSION_COPY } from '../../shared/copy/session'
import type { Task } from '../../shared/types'
import type { Live } from './App'
import { Composer } from './Composer'
import { Header } from './Header'
import { Icon } from './Icon'
import { unwrap } from './ipc'
import { renderMd } from './markdown'
import { needsEndConfirm, startSessionFlow } from './sessionStart'
import { attachTerm, disposeTerm, getTerm, hasTerm } from './terms'

type SessionTool = 'claude-code' | 'codex' | 'cursor' | 'other'
const TOOLS: SessionTool[] = ['claude-code', 'codex', 'cursor', 'other']
const toolOf = (value: string): SessionTool =>
  TOOLS.includes(value as SessionTool) ? (value as SessionTool) : 'claude-code'

type Props = {
  task: Task
  live: Live
  focused: boolean
  draft: boolean
  onStarted(id: string): void
  onPin(): void // retomar/criar sessão fixa a aba prévia
  onEnd(id: string): void
}

export function TaskView({
  task,
  live,
  focused,
  draft,
  onStarted,
  onEnd,
  onPin
}: Props): React.JSX.Element {
  const id = task.id
  const alive = live.alive.has(id)
  const exitCode = live.exited[id]
  const host = useRef<HTMLDivElement>(null)
  const pending = useRef<{ tool: SessionTool; resume?: string } | null>(null)
  const [domainId, setDomainId] = useState<string | null>(null)
  const [notImported, setNotImported] = useState(false)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [starting, setStarting] = useState(false)
  const [err, setErr] = useState('')
  // Abrir a task mostra o README; o terminal só entra quando a sessão é retomada/criada.
  const [view, setView] = useState<'readme' | 'term'>(() =>
    alive || hasTerm(id) ? 'term' : 'readme'
  )
  const [readme, setReadme] = useState('')
  const showTerm = view === 'term' && (alive || starting || hasTerm(id))

  const launching = useRef(false)

  const launch = (how: { tool: SessionTool; resume?: string }): void => {
    if (launching.current) return // duplo clique: um start por vez
    launching.current = true
    const e = getTerm(id)
    void startSessionFlow(window.turnflow, {
      pty_id: id,
      task: id,
      task_id: domainId ?? undefined,
      tool: how.tool,
      resume: how.resume,
      cols: e.term.cols,
      rows: e.term.rows
    })
      .then((r) => {
        if (r.ok) onStarted(id)
        else if (!('cancelled' in r)) {
          disposeTerm(id)
          setErr(r.message)
        }
      })
      .finally(() => {
        launching.current = false
        setStarting(false)
      })
  }

  const start = (how: { tool: SessionTool; resume?: string }): void => {
    onPin()
    setErr('')
    setView('term')
    setStarting(true)
    // xterm já anexado (reabrir/trocar sessão): lança direto; senão espera o efeito anexar
    if (hasTerm(id) && host.current) launch(how)
    else pending.current = how
  }

  const switchTo = (sessionId: string): void => {
    const row = sessions.find((s) => s.id === sessionId)
    if (alive) window.turnflow.kill({ id })
    getTerm(id).term.write('\r\n\x1b[2m── trocando de sessão ──\x1b[0m\r\n')
    start({ tool: toolOf(row?.tool ?? 'claude-code'), resume: sessionId })
  }

  useEffect(() => {
    let cancel = false
    void (async () => {
      const got = await window.turnflow.taskGet({ id })
      if (cancel) return
      if (!got.ok) {
        setSessions([])
        setDomainId(null)
        setNotImported(got.error.code === 'NOT_FOUND')
        if (got.error.code !== 'NOT_FOUND') setErr(got.error.message)
        return
      }
      const listed = await window.turnflow.sessionList({ task_id: got.data.id })
      if (cancel) return
      if (!listed.ok) {
        setErr(listed.error.message)
        return
      }
      setNotImported(false)
      setDomainId(got.data.id)
      setSessions(listed.data)
    })()
    return () => {
      cancel = true
    }
  }, [id])

  // README recarrega quando a lista de tasks muda (o objeto task vem novo)
  useEffect(() => {
    unwrap(window.turnflow.readme({ id })).then((r) => setReadme(r ?? ''))
  }, [id, task])

  useEffect(() => {
    if (!showTerm || !host.current) return
    const e = attachTerm(id, host.current)
    const ro = new ResizeObserver(() => e.fit.fit())
    ro.observe(host.current)
    const how = pending.current
    if (how) {
      pending.current = null
      launch(how)
    }
    return () => {
      ro.disconnect()
      e.el.remove()
    }
  }, [showTerm, id])

  useEffect(() => {
    if (focused && showTerm && !draft) requestAnimationFrame(() => getTerm(id).term.focus())
  }, [focused, showTerm, id, draft])

  // Reabrir após o processo sair: se não dá pra retomar, larga o xterm velho e mostra o aviso com "Nova sessão".
  const resumable = sessions.filter((s) => s.ended_at !== null && s.external_id)
  const reopen = (): void => {
    const row = resumable[0]
    if (row) start({ tool: toolOf(row.tool), resume: row.id })
    else {
      disposeTerm(id)
      setView('readme')
    }
  }

  const hasSession = alive || hasTerm(id)
  const toggle = hasSession && (
    <button
      onClick={() => setView((v) => (v === 'term' ? 'readme' : 'term'))}
      title="Alterna entre o README e o terminal"
    >
      <Icon name={view === 'term' ? 'file' : 'terminal'} size={13} />{' '}
      {view === 'term' ? 'README' : 'Terminal'}
    </button>
  )

  // Barra de ação em cima do README: o que dá pra fazer com a sessão desta task.
  const actions = hasSession ? (
    <div className="readme-actions">
      <span>Sessão {alive ? 'rodando' : 'encerrada'}.</span>
      <button className="primary" onClick={() => setView('term')}>
        <Icon name="terminal" size={13} /> Ir pro terminal
      </button>
    </div>
  ) : (
    <div className="readme-actions">
      {notImported && <span>{SESSION_COPY.notImported}</span>}
      {!notImported &&
        resumable.map((s) => (
          <button key={s.id} onClick={() => start({ tool: toolOf(s.tool), resume: s.id })}>
            {SESSION_COPY.resume} {s.label || s.external_id?.slice(0, 8)}
          </button>
        ))}
      {!notImported && !resumable.length && <span>{SESSION_COPY.pickWorkdir}</span>}
      {!notImported && (
        <>
          <button className="primary" onClick={() => start({ tool: 'claude-code' })}>
            <Icon name="plus" size={13} /> {SESSION_COPY.newSession}
          </button>
          <button onClick={() => start({ tool: 'codex' })}>Codex</button>
          <button onClick={() => start({ tool: 'cursor' })}>Cursor</button>
          <button onClick={() => start({ tool: 'other' })}>Other</button>
        </>
      )}
    </div>
  )

  return (
    <div className="taskview">
      <Header
        task={task}
        alive={alive}
        onEnd={() => {
          if (needsEndConfirm(live.states[id]) && !window.confirm(SESSION_COPY.endWhileWorking))
            return
          onEnd(id)
        }}
        onSwitch={switchTo}
        extra={toggle}
      />
      {exitCode !== undefined && !alive && !starting && view === 'term' && (
        <div className="banner">
          Processo saiu (código {exitCode}). <button onClick={reopen}>Reabrir</button>{' '}
          <button onClick={() => start({ tool: 'claude-code' })}>{SESSION_COPY.newSession}</button>
        </div>
      )}
      {err && <div className="banner error">{err}</div>}
      {showTerm ? (
        <>
          <div className="term" ref={host} />
          {draft && alive && <Composer id={id} focused={focused} onSent={() => undefined} />}
        </>
      ) : (
        <div className="readme-view">
          {actions}
          <article
            className="md"
            onClick={(e) => {
              // link relativo (outro .md do brain) não navega a janela
              const a = (e.target as HTMLElement).closest('a')
              if (a && a.getAttribute('target') !== '_blank') e.preventDefault()
            }}
            dangerouslySetInnerHTML={{ __html: renderMd(readme) }}
          />
        </div>
      )}
    </div>
  )
}
