import { useEffect, useRef, useState } from 'react'
import type { How, Plan, Task } from '../../shared/types'
import { BRAND } from '../../shared/brand'
import type { Live } from './App'
import { attachTerm, disposeTerm, getTerm, hasTerm } from './terms'
import { Header } from './Header'
import { Composer } from './Composer'
import { Icon } from './Icon'
import { renderMd } from './markdown'

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
  const pending = useRef<How | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [starting, setStarting] = useState(false)
  const [err, setErr] = useState('')
  // Abrir a task mostra o README; o terminal só entra quando a sessão é retomada/criada.
  const [view, setView] = useState<'readme' | 'term'>(() =>
    alive || hasTerm(id) ? 'term' : 'readme'
  )
  const [readme, setReadme] = useState('')
  const showTerm = view === 'term' && (alive || starting || hasTerm(id))

  const launching = useRef(false)

  const launch = (how: How): void => {
    if (launching.current) return // duplo clique: um start por vez
    launching.current = true
    const e = getTerm(id)
    window.dk
      .start(id, how, e.term.cols, e.term.rows)
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

  const start = (how: How): void => {
    onPin()
    setErr('')
    setView('term')
    setStarting(true)
    // xterm já anexado (reabrir/trocar sessão): lança direto; senão espera o efeito anexar
    if (hasTerm(id) && host.current) launch(how)
    else pending.current = how
  }

  const switchTo = (uuid: string): void => {
    if (alive) window.dk.kill(id)
    getTerm(id).term.write('\r\n\x1b[2m── trocando de sessão ──\x1b[0m\r\n')
    start({ resume: uuid })
  }

  useEffect(() => {
    window.dk.plan(id).then(setPlan, (e) => setErr(cleanErr(e)))
  }, [id])

  // README recarrega quando a lista de tasks muda (o objeto task vem novo)
  useEffect(() => {
    window.dk.readme(id).then(setReadme)
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
    window.dk.plan(id).then(
      (p) => {
        setPlan(p)
        if (p.kind === 'resume') start({ resume: p.uuid })
        else {
          disposeTerm(id)
          setView('readme')
        }
      },
      (e) => setErr(cleanErr(e))
    )
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
      {!plan && !err && <span>Procurando sessão…</span>}
      {plan?.kind === 'resume' && (
        <>
          <span>
            Última sessão: {task.sessions.find((s) => s.uuid === plan.uuid)?.date ?? ''} —{' '}
            {task.sessions.find((s) => s.uuid === plan.uuid)?.desc || plan.uuid.slice(0, 8)}
          </span>
          <button className="primary" onClick={() => start({ resume: plan.uuid })}>
            <Icon name="terminal" size={13} /> Retomar sessão
          </button>
        </>
      )}
      {plan?.kind === 'elsewhere' &&
        (plan.by ? (
          <span>Essa conversa já está aberta na aba {plan.by}.</span>
        ) : (
          <span>
            Sessão aberta fora do {BRAND.name} (PID {plan.pid}).
          </span>
        ))}
      {plan?.kind === 'gone' && <span>A pasta dessa sessão não existe mais ({plan.cwd}).</span>}
      {plan?.kind === 'missing' && (
        <span>As sessões gravadas não existem mais (o Claude Code apaga após 30 dias).</span>
      )}
      {plan?.kind === 'none' && <span>Essa task ainda não tem sessão.</span>}
      {plan?.kind === 'elsewhere' && (
        <button onClick={() => window.dk.plan(id).then(setPlan, (e) => setErr(cleanErr(e)))}>
          Já fechei lá — tentar de novo
        </button>
      )}
      <button
        className={plan?.kind === 'resume' ? '' : 'primary'}
        onClick={() => start({ newPrompt: true })}
      >
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
          <button onClick={() => start({ newPrompt: true })}>Nova sessão</button>
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
