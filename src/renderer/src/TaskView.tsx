import { useEffect, useRef, useState } from 'react'
import type { ProjectRow, SessionRow, TaskDetail } from '../../shared/contracts'
import { SESSION_COPY } from '../../shared/copy/session'
import type { Task } from '../../shared/types'
import type { Live } from './App'
import { Composer } from './Composer'
import { Header } from './Header'
import { Icon } from './Icon'
import { unwrap } from './ipc'
import { renderMd } from './markdown'
import { needsEndConfirm, startSessionFlow } from './sessionStart'
import { TaskHeader } from './TaskHeader'
import {
  CLOSE_WHILE_WORKING,
  closeNeedsConfirm,
  previousStageId,
  suggestedMapping,
  timelineItems,
  undoToast,
  type MenuId
} from './taskFace'
import { TimelineView } from './TimelineView'
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

type Ask =
  | null
  | { kind: 'workdir'; value: string }
  | { kind: 'block'; value: string }
  | { kind: 'move'; projectId: string | null; pending: boolean }

const reasonOf = (details: unknown): string | undefined =>
  details &&
  typeof details === 'object' &&
  'reason' in details &&
  typeof details.reason === 'string'
    ? details.reason
    : undefined

const previewOf = (details: unknown): { from: { id: string }; to_stage_id: string | null }[] => {
  if (!details || typeof details !== 'object' || !('preview' in details)) return []
  const preview = details.preview
  if (!Array.isArray(preview)) return []
  return preview.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('from' in item)) return []
    const from = item.from
    const to = 'to_stage_id' in item ? item.to_stage_id : null
    if (!from || typeof from !== 'object' || !('id' in from) || typeof from.id !== 'string')
      return []
    return [{ from: { id: from.id }, to_stage_id: typeof to === 'string' ? to : null }]
  })
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
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [mode, setMode] = useState<'loading' | 'domain' | 'brain'>('loading')
  const [notImported, setNotImported] = useState(false)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [starting, setStarting] = useState(false)
  const [err, setErr] = useState('')
  const [view, setView] = useState<'readme' | 'term'>(() =>
    alive || hasTerm(id) ? 'term' : 'readme'
  )
  const [readme, setReadme] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [toast, setToast] = useState<{ activityId: string; until: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [ask, setAsk] = useState<Ask>(null)
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [only, setOnly] = useState<'all' | 'checkpoint' | 'session'>('all')
  const showTerm = view === 'term' && (alive || starting || hasTerm(id))

  const launching = useRef(false)
  const reload = (): void => setReloadTick((n) => n + 1)
  const remember = (activityId: string | null): void => {
    const next = undoToast(activityId, Date.now())
    if (!next) return
    setNow(Date.now())
    setToast(next)
  }

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
        setDetail(null)
        setSessions([])
        setDomainId(null)
        setMode('brain')
        setNotImported(got.error.code === 'NOT_FOUND')
        if (got.error.code !== 'NOT_FOUND') setErr(got.error.message)
        return
      }
      const listed = await window.turnflow.sessionList({ task_id: got.data.id })
      if (cancel) return
      if (!listed.ok) {
        setErr(listed.error.message)
        setSessions(got.data.sessions)
      } else setSessions(listed.data)
      setNotImported(false)
      setDomainId(got.data.id)
      setDetail(listed.ok ? { ...got.data, sessions: listed.data } : got.data)
      setMode('domain')
    })()
    return () => {
      cancel = true
    }
  }, [id, reloadTick])

  useEffect(() => {
    const off = window.turnflow.onDomainChanged((change) => {
      if (change.entity !== 'task' && change.entity !== 'session') return
      if (domainId && change.ids.length && !change.ids.includes(domainId)) return
      setReloadTick((n) => n + 1)
    })
    return () => off()
  }, [domainId])

  useEffect(() => {
    if (!toast) return
    const tick = (): void => {
      const at = Date.now()
      setNow(at)
      if (at >= toast.until) setToast(null)
    }
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [toast])

  useEffect(() => {
    if (mode !== 'brain') return
    unwrap(window.turnflow.readme({ id })).then((r) => setReadme(r ?? ''))
  }, [id, task, mode])

  useEffect(() => {
    if (ask?.kind !== 'move') return
    void unwrap(window.turnflow.projectList()).then((rows) => rows && setProjects(rows))
  }, [ask])

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

  const runStage = (stageId: string): void => {
    if (!detail) return
    void window.turnflow.taskSetStage({ id: detail.id, stage_id: stageId }).then((r) => {
      if (!r.ok) {
        setErr(r.error.message)
        return
      }
      remember(r.data.activity_id)
      reload()
    })
  }

  const runMove = (
    projectId: string | null,
    choice?: 'keep' | 'adopt',
    mapping?: Record<string, string>
  ): void => {
    if (!detail) return
    void window.turnflow
      .taskMove({
        id: detail.id,
        project_id: projectId,
        ...(choice ? { choice } : {}),
        ...(mapping ? { mapping } : {})
      })
      .then((r) => {
        if (r.ok) {
          remember(r.data.activity_id)
          setAsk(null)
          reload()
          return
        }
        const why = reasonOf(r.error.details)
        if (why === 'choose_keep_adopt') {
          setAsk({ kind: 'move', projectId, pending: true })
          return
        }
        if (why === 'remap_required') {
          if (mapping) {
            setErr(r.error.message)
            return
          }
          const next = suggestedMapping(previewOf(r.error.details), detail.stage.id)
          if (!next) {
            setErr(r.error.message)
            return
          }
          runMove(projectId, 'adopt', next)
          return
        }
        setErr(r.error.message)
      })
  }

  const onAction = (action: MenuId): void => {
    if (!detail) return
    setErr('')
    if (action === 'record') {
      setOnly('checkpoint')
      setView('readme')
      setAsk(null)
      return
    }
    if (action === 'sessions') {
      setOnly('session')
      setView('readme')
      setAsk(null)
      return
    }
    if (action === 'workdir') {
      setAsk({ kind: 'workdir', value: detail.workdir ?? '' })
      return
    }
    if (action === 'move') {
      setAsk({ kind: 'move', projectId: null, pending: false })
      return
    }
    if (action === 'block') {
      setAsk({ kind: 'block', value: '' })
      return
    }
    if (action === 'previous-stage') {
      const stageId = previousStageId(detail.flow_stages, detail.stage.id)
      if (stageId) runStage(stageId)
      return
    }
    if (action === 'unblock') {
      void window.turnflow.taskUnblock({ id: detail.id }).then((r) => {
        if (!r.ok) {
          setErr(r.error.message)
          return
        }
        remember(r.data.activity_id)
        reload()
      })
      return
    }
    if (action === 'close') {
      if (closeNeedsConfirm(live.states[id]) && !window.confirm(CLOSE_WHILE_WORKING)) return
      void window.turnflow.taskClose({ id: detail.id }).then((r) => {
        if (!r.ok) {
          setErr(r.error.message)
          return
        }
        remember(r.data.activity_id)
        reload()
      })
    }
  }

  const undo = (): void => {
    if (!toast) return
    void window.turnflow.activityUndo({ activity_id: toast.activityId }).then((r) => {
      if (!r.ok) {
        setErr(r.error.message)
        return
      }
      setToast(null)
      reload()
    })
  }

  if (mode === 'loading') {
    return (
      <div className="taskview">
        <div className="th">
          <span className="th-title">
            <b>{id}</b> — {task.title}
          </span>
        </div>
      </div>
    )
  }

  if (mode === 'brain' || !detail) {
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
            <button onClick={() => start({ tool: 'claude-code' })}>
              {SESSION_COPY.newSession}
            </button>
          </div>
        )}
        {err && <div className="banner error">{err}</div>}
        {showTerm ? (
          <>
            <div className="term term-plain" ref={host} />
            {draft && alive && <Composer id={id} focused={focused} onSent={() => undefined} />}
          </>
        ) : (
          <div className="readme-view">
            {actions}
            <article
              className="md"
              onClick={(e) => {
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

  const marks = timelineItems({ checkpoints: detail.checkpoints, sessions })
  const shown = only === 'all' ? marks : marks.filter((item) => item.kind === only)
  const moveProject = ask?.kind === 'move' ? projects : []

  return (
    <div className="taskview">
      <TaskHeader
        taskKey={detail.key}
        title={detail.title}
        summary={detail}
        stages={detail.flow_stages}
        stageId={detail.stage.id}
        blocked={detail.blocked_reason !== null}
        toast={toast}
        now={now}
        onSave={(patch) => {
          void window.turnflow.taskUpdate({ id: detail.id, patch }).then((r) => {
            if (!r.ok) {
              setErr(r.error.message)
              return
            }
            reload()
          })
        }}
        onStage={runStage}
        onAction={onAction}
        onUndo={undo}
        trailing={
          alive ? (
            <button
              onClick={() => {
                if (
                  needsEndConfirm(live.states[id]) &&
                  !window.confirm(SESSION_COPY.endWhileWorking)
                )
                  return
                onEnd(id)
              }}
            >
              End session
            </button>
          ) : hasTerm(id) ? (
            <button onClick={() => setView((v) => (v === 'term' ? 'readme' : 'term'))}>
              {view === 'term' ? 'Record' : 'Terminal'}
            </button>
          ) : null
        }
      />
      {ask?.kind === 'workdir' && (
        <form
          className="task-ask"
          onSubmit={(event) => {
            event.preventDefault()
            const value = ask.value.trim()
            void window.turnflow
              .taskSetWorkdir({ id: detail.id, workdir: value === '' ? null : value })
              .then((r) => {
                if (!r.ok) {
                  setErr(r.error.message)
                  return
                }
                setAsk(null)
                reload()
              })
          }}
        >
          <label>
            Working folder
            <input
              value={ask.value}
              onChange={(event) => setAsk({ kind: 'workdir', value: event.target.value })}
            />
          </label>
          <button type="submit">Save</button>
        </form>
      )}
      {ask?.kind === 'block' && (
        <form
          className="task-ask"
          onSubmit={(event) => {
            event.preventDefault()
            const reason = ask.value.trim()
            if (!reason) return
            void window.turnflow.taskBlock({ id: detail.id, reason }).then((r) => {
              if (!r.ok) {
                setErr(r.error.message)
                return
              }
              remember(r.data.activity_id)
              setAsk(null)
              reload()
            })
          }}
        >
          <label>
            Block
            <input
              value={ask.value}
              onChange={(event) => setAsk({ kind: 'block', value: event.target.value })}
            />
          </label>
          <button type="submit">Block</button>
        </form>
      )}
      {ask?.kind === 'move' && (
        <div className="task-ask">
          {ask.pending ? (
            <>
              <p>Keep the current flow, or adopt the project flow?</p>
              <button onClick={() => runMove(ask.projectId, 'keep')}>Keep</button>
              <button onClick={() => runMove(ask.projectId, 'adopt')}>Adopt</button>
            </>
          ) : (
            <>
              <button onClick={() => runMove(null)}>No project</button>
              {moveProject.map((project) => (
                <button key={project.id} onClick={() => runMove(project.id)}>
                  {project.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {exitCode !== undefined && !alive && !starting && view === 'term' && (
        <div className="banner">
          Processo saiu (código {exitCode}). <button onClick={reopen}>Reabrir</button>{' '}
          <button onClick={() => start({ tool: 'claude-code' })}>{SESSION_COPY.newSession}</button>
        </div>
      )}
      {err && <div className="banner error">{err}</div>}
      {showTerm ? (
        <>
          <div className="term term-plain" ref={host} />
          {draft && alive && <Composer id={id} focused={focused} onSent={() => undefined} />}
        </>
      ) : (
        <div className="timeline-wrap">
          <div className="timeline-actions">
            <button onClick={() => start({ tool: 'codex' })}>Codex</button>
            <button onClick={() => start({ tool: 'cursor' })}>Cursor</button>
            <button onClick={() => start({ tool: 'other' })}>Other</button>
          </div>
          <TimelineView
            items={shown}
            onNew={() => start({ tool: 'claude-code' })}
            onResume={(sessionId) => {
              const row = sessions.find((s) => s.id === sessionId)
              start({ tool: toolOf(row?.tool ?? 'claude-code'), resume: sessionId })
            }}
          />
        </div>
      )}
    </div>
  )
}
