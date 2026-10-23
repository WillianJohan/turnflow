import { useEffect, useRef, useState } from 'react'
import type { Task } from '../../shared/types'
import type { Live } from './App'
import { attachTerm, disposeTerm, getTerm, hasTerm } from './terms'
import { Header } from './Header'
import { Composer } from './Composer'
import { Icon } from './Icon'
import { renderMd } from './markdown'
import { orThrow, unwrap } from './ipc'

type Props = {
  task: Task
  live: Live
  focused: boolean
  draft: boolean
  onStarted(id: string): void
  onPin(): void // retomar/criar sessão fixa a aba prévia
  onEnd(id: string): void
}

const cleanErr = (e: unknown): string =>
  String((e as Error)?.message ?? e).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ''
  )

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
  const pending = useRef<{ resume?: string } | null>(null)
  const [offer, setOffer] = useState<{
    session_id: string
    external_id: string
    started_at: string
    label: string | null
  } | null>(null)
  const [starting, setStarting] = useState(false)
  const [err, setErr] = useState('')
  // Abrir a task mostra o README; o terminal só entra quando a sessão é retomada/criada.
  const [view, setView] = useState<'readme' | 'term'>(() =>
    alive || hasTerm(id) ? 'term' : 'readme'
  )
  const [readme, setReadme] = useState('')
  const showTerm = view === 'term' && (alive || starting || hasTerm(id))

  const launching = useRef(false)

  const launch = (how: { resume?: string }): void => {
    if (launching.current) return // duplo clique: um start por vez
    launching.current = true
    const e = getTerm(id)
    orThrow(
      window.turnflow.ptySpawn({
        kind: 'agent',
        pty_id: id,
        tool: 'claude-code',
        task: id,
        cols: e.term.cols,
        rows: e.term.rows,
        ...(how.resume ? { resume: how.resume } : {})
      })
    )
      .then(
        () => onStarted(id),
        (x) => {
          disposeTerm(id)
          setErr(cleanErr(x))
        }
      )
      .finally(() => {
        launching.current = false
        setStarting(false)
      })
  }

  const start = (how: { resume?: string }): void => {
    onPin()
    setErr('')
    setView('term')
    setStarting(true)
    // xterm já anexado (reabrir/trocar sessão): lança direto; senão espera o efeito anexar
    if (hasTerm(id) && host.current) launch(how)
    else pending.current = how
  }

  const switchTo = (uuid: string): void => {
    if (alive) window.turnflow.kill({ id })
    getTerm(id).term.write('\r\n\x1b[2m── trocando de sessão ──\x1b[0m\r\n')
    start({ resume: uuid })
  }

  useEffect(() => {
    let cancel = false
    void (async () => {
      const got = await window.turnflow.taskGet({ id })
      if (cancel) return
      if (!got.ok) {
        setOffer(null)
        setErr(got.error.message)
        return
      }
      const listed = await window.turnflow.sessionList({ task_id: got.data.id })
      if (cancel) return
      if (!listed.ok) {
        setErr(listed.error.message)
        return
      }
      const row = listed.data.find((s) => s.ended_at !== null && s.external_id)
      setOffer(
        row?.external_id
          ? {
              session_id: row.id,
              external_id: row.external_id,
              started_at: row.started_at,
              label: row.label
            }
          : null
      )
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
  const reopen = (): void => {
    if (offer) start({ resume: offer.session_id })
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
      {offer && (
        <>
          <span>
            Última sessão: {offer.started_at} — {offer.label || offer.external_id.slice(0, 8)}
          </span>
          <button className="primary" onClick={() => start({ resume: offer.session_id })}>
            <Icon name="terminal" size={13} /> Retomar sessão
          </button>
        </>
      )}
      {!offer && <span>Essa task ainda não tem sessão.</span>}
      <button className={offer ? '' : 'primary'} onClick={() => start({})}>
        <Icon name="plus" size={13} /> Nova sessão
      </button>
    </div>
  )

  return (
    <div className="taskview">
      <Header
        task={task}
        alive={alive}
        onEnd={() => onEnd(id)}
        onSwitch={switchTo}
        extra={toggle}
      />
      {exitCode !== undefined && !alive && !starting && view === 'term' && (
        <div className="banner">
          Processo saiu (código {exitCode}). <button onClick={reopen}>Reabrir</button>{' '}
          <button onClick={() => start({})}>Nova sessão</button>
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
