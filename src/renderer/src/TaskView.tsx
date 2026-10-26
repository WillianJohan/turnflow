import { useEffect, useRef, useState } from 'react'
import {
  SESSION_TOOLS,
  type ProjectRow,
  type SessionRow,
  type SessionTool,
  type TaskDetail
} from '../../shared/contracts'
import { SESSION_COPY } from '../../shared/copy/session'
import { SHELL_COPY } from '../../shared/copy/shell'
import type { Task } from '../../shared/types'
import type { Live, TabName } from './App'
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
  type MenuId
} from './taskFace'
import { TimelineView } from './TimelineView'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { attachTerm, disposeTerm, getTerm, hasTerm } from './terms'

const toolOf = (value: string): SessionTool =>
  (SESSION_TOOLS as readonly string[]).includes(value) ? (value as SessionTool) : 'claude-code'

type Props = {
  /** id da aba: ULID da task do domínio ou id do brain (que é a key quando importada). */
  id: string
  task?: Task
  name?: TabName
  live: Live
  focused: boolean
  draft: boolean
  onStarted(id: string): void
  onPin(): void // retomar/criar sessão fixa a aba prévia
  onEnd(id: string): void
  /** Ação com Desfazer: o toast mora no app, então sobrevive a trocar ou fechar a aba. */
  onUndoable?(activityId: string, text: string): void
  /** A aba abriu pelo id do brain de uma task importada: passa a ser a aba do id do domínio. */
  onCanonical?(from: string, to: string): void
}

type Ask =
  | null
  | { kind: 'workdir'; value: string }
  | { kind: 'block'; value: string }
  | { kind: 'move'; projectId: string | null; pending: boolean }
  | {
      kind: 'remap'
      projectId: string | null
      mapping: Record<string, string>
      from: string
      to: string
    }

type Confirm = { body: string; confirm: string; run(): void } | null

const T = SHELL_COPY.taskView

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
  id,
  task,
  name,
  live,
  focused,
  draft,
  onStarted,
  onEnd,
  onPin,
  onUndoable,
  onCanonical
}: Props): React.JSX.Element {
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
  const [ask, setAsk] = useState<Ask>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [only, setOnly] = useState<'all' | 'checkpoint' | 'session'>('all')
  const showTerm = view === 'term' && (alive || starting || hasTerm(id))

  const launching = useRef(false)
  const aliveRef = useRef(alive)
  useEffect(() => {
    aliveRef.current = alive
  }, [alive])
  const reload = (): void => setReloadTick((n) => n + 1)
  // Aba aberta pelo id do brain (ui.json antigo, árvore, paleta antes do FTS) de task importada:
  // vira a aba do ULID. Com processo vivo no id antigo espera ele sair (o pty_id é o id da aba).
  useEffect(() => {
    if (domainId && domainId !== id && !alive && !starting) onCanonical?.(id, domainId)
  }, [domainId, id, alive, starting, onCanonical])
  const remember = (activityId: string | null, text: string): void => {
    if (activityId) onUndoable?.(activityId, text)
  }
  // a IA trabalhando conta venha de onde vier: PTY deste app ou sessão de fora (ai_session)
  const working = (): boolean =>
    closeNeedsConfirm(live.states[id]) || closeNeedsConfirm(detail?.session?.state)
  const askEnd = (): void => {
    if (!needsEndConfirm(live.states[id])) onEnd(id)
    else
      setConfirm({
        body: SESSION_COPY.endWhileWorking,
        confirm: T.endSession,
        run: () => onEnd(id)
      })
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
          // pty_busy: o processo velho ainda é dono do xterm; derrubar aqui apagaria a tela dele
          if (!aliveRef.current && r.reason !== 'pty_busy') disposeTerm(id)
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
    getTerm(id).term.write(`\r\n\x1b[2m── ${T.switching} ──\x1b[0m\r\n`)
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
      // `ids` de evento de sessão são ids de sessão: não dá pra filtrar pela task
      if (
        change.entity === 'task' &&
        domainId &&
        change.ids.length &&
        !change.ids.includes(domainId)
      )
        return
      setReloadTick((n) => n + 1)
    })
    return () => off()
  }, [domainId])

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
    if (!detail || stageId === detail.stage.id) return
    const stage = detail.flow_stages.find((s) => s.id === stageId)
    void window.turnflow.taskSetStage({ id: detail.id, stage_id: stageId }).then((r) => {
      if (!r.ok) {
        setErr(r.error.message)
        return
      }
      remember(
        r.data.activity_id,
        T.undo.stage(stage?.short_name ?? '', r.data.outbox === 'queued')
      )
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
          remember(r.data.activity_id, T.undo.moved)
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
          // mostra o par sugerido antes de aplicar: a etapa da task muda junto com o fluxo
          const toId = next[detail.stage.id]
          void unwrap(window.turnflow.flowList()).then((flows) => {
            const to = flows?.flatMap((f) => f.stages).find((st) => st.id === toId)
            setAsk({
              kind: 'remap',
              projectId,
              mapping: next,
              from: detail.stage.short_name,
              to: to?.short_name ?? to?.name ?? toId
            })
          })
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
        remember(r.data.activity_id, T.undo.unblocked)
        reload()
      })
      return
    }
    if (action === 'close') {
      const close = (): void => {
        void window.turnflow.taskClose({ id: detail.id }).then((r) => {
          if (!r.ok) {
            setErr(r.error.message)
            return
          }
          remember(r.data.activity_id, T.undo.closed)
          reload()
        })
      }
      if (working()) setConfirm({ body: CLOSE_WHILE_WORKING, confirm: T.closeTask, run: close })
      else close()
    }
  }

  // Esc ou Cancelar fecham o formulário da task sem gravar
  const askKeys = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    setAsk(null)
  }
  const cancelAsk = (
    <button type="button" onClick={() => setAsk(null)}>
      {T.cancel}
    </button>
  )
  const confirmDialog = confirm && (
    <div className="overlay">
      <ConfirmDialog
        title={T.confirmTitle}
        body={confirm.body}
        confirm={confirm.confirm}
        cancel={T.cancel}
        onConfirm={confirm.run}
        onClose={() => setConfirm(null)}
      />
    </div>
  )

  if (mode === 'loading') {
    return (
      <div className="taskview">
        <div className="th">
          <span className="th-title">
            <b>{name?.key ?? id}</b> — {name?.title ?? task?.title ?? ''}
          </span>
        </div>
      </div>
    )
  }

  if (mode === 'brain' || !detail) {
    if (!task)
      return (
        <div className="taskview">
          <div className="notice">{SHELL_COPY.task.gone(name?.key ?? id)}</div>
        </div>
      )
    const hasSession = alive || hasTerm(id)
    const toggle = hasSession && (
      <button
        onClick={() => setView((v) => (v === 'term' ? 'readme' : 'term'))}
        title={SHELL_COPY.brainView.toggle}
      >
        <Icon name={view === 'term' ? 'file' : 'terminal'} size={13} />{' '}
        {view === 'term' ? SHELL_COPY.brainView.readme : SHELL_COPY.brainView.terminal}
      </button>
    )
    const actions = hasSession ? (
      <div className="readme-actions">
        <span>{SHELL_COPY.brainView.session(alive)}</span>
        <button className="primary" onClick={() => setView('term')}>
          <Icon name="terminal" size={13} /> {SHELL_COPY.brainView.toTerminal}
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
            <button onClick={() => start({ tool: 'other' })}>{T.other}</button>
          </>
        )}
      </div>
    )
    return (
      <div className="taskview">
        <Header task={task} alive={alive} onEnd={askEnd} onSwitch={switchTo} extra={toggle} />
        {exitCode !== undefined && !alive && !starting && view === 'term' && (
          <div className="banner">
            {T.exited(exitCode)} <button onClick={reopen}>{T.reopen}</button>{' '}
            <button onClick={() => start({ tool: 'claude-code' })}>
              {SESSION_COPY.newSession}
            </button>
          </div>
        )}
        {err && <div className="banner error">{err}</div>}
        {confirmDialog}
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
  const moveProject = ask?.kind === 'move' ? projects : []
  const termToggle = (alive || hasTerm(id)) && (
    <button onClick={() => setView((v) => (v === 'term' ? 'readme' : 'term'))}>
      {view === 'term' ? T.record : T.terminal}
    </button>
  )

  return (
    <div className="taskview">
      <TaskHeader
        taskKey={detail.key}
        title={detail.title}
        summary={detail}
        stages={detail.flow_stages}
        stageId={detail.stage.id}
        blocked={detail.blocked_reason !== null}
        toast={null}
        now={0}
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
        onUndo={() => undefined}
        trailing={
          <>
            {termToggle}
            {alive && <button onClick={askEnd}>{T.endSession}</button>}
          </>
        }
      />
      {ask?.kind === 'workdir' && (
        <form
          className="task-ask"
          onKeyDown={askKeys}
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
            {T.workdir}
            <input
              autoFocus
              value={ask.value}
              onChange={(event) => setAsk({ kind: 'workdir', value: event.target.value })}
            />
          </label>
          <button type="submit">{T.save}</button>
          {cancelAsk}
        </form>
      )}
      {ask?.kind === 'block' && (
        <form
          className="task-ask"
          onKeyDown={askKeys}
          onSubmit={(event) => {
            event.preventDefault()
            const reason = ask.value.trim()
            if (!reason) return
            void window.turnflow.taskBlock({ id: detail.id, reason }).then((r) => {
              if (!r.ok) {
                setErr(r.error.message)
                return
              }
              remember(r.data.activity_id, T.undo.blocked)
              setAsk(null)
              reload()
            })
          }}
        >
          <label>
            {T.block}
            <input
              autoFocus
              value={ask.value}
              onChange={(event) => setAsk({ kind: 'block', value: event.target.value })}
            />
          </label>
          <button type="submit">{T.block}</button>
          {cancelAsk}
        </form>
      )}
      {ask?.kind === 'move' && (
        <div className="task-ask" onKeyDown={askKeys}>
          {ask.pending ? (
            <>
              <p>{T.keepOrAdopt}</p>
              <button autoFocus onClick={() => runMove(ask.projectId, 'keep')}>
                {T.keep}
              </button>
              <button onClick={() => runMove(ask.projectId, 'adopt')}>{T.adopt}</button>
            </>
          ) : (
            <>
              <button autoFocus onClick={() => runMove(null)}>
                {T.noProject}
              </button>
              {moveProject.map((project) => (
                <button key={project.id} onClick={() => runMove(project.id)}>
                  {project.name}
                </button>
              ))}
            </>
          )}
          {cancelAsk}
        </div>
      )}
      {ask?.kind === 'remap' && (
        <div className="task-ask" onKeyDown={askKeys}>
          <p>{T.remap(ask.from, ask.to)}</p>
          <button autoFocus onClick={() => runMove(ask.projectId, 'adopt', ask.mapping)}>
            {T.apply}
          </button>
          {cancelAsk}
        </div>
      )}
      {exitCode !== undefined && !alive && !starting && view === 'term' && (
        <div className="banner">
          {T.exited(exitCode)} <button onClick={reopen}>{T.reopen}</button>{' '}
          <button onClick={() => start({ tool: 'claude-code' })}>{SESSION_COPY.newSession}</button>
        </div>
      )}
      {err && <div className="banner error">{err}</div>}
      {confirmDialog}
      {showTerm ? (
        <>
          <div className="term term-plain" ref={host} />
          {draft && alive && <Composer id={id} focused={focused} onSent={() => undefined} />}
        </>
      ) : (
        <div className="timeline-wrap">
          <TimelineView
            items={marks}
            live={alive}
            onTerminal={() => setView('term')}
            filter={only}
            onFilter={setOnly}
            onNew={() => start({ tool: 'claude-code' })}
            onResume={(sessionId) => {
              const row = sessions.find((s) => s.id === sessionId)
              start({ tool: toolOf(row?.tool ?? 'claude-code'), resume: sessionId })
            }}
            extra={
              <>
                <button onClick={() => start({ tool: 'codex' })}>Codex</button>
                <button onClick={() => start({ tool: 'cursor' })}>Cursor</button>
                <button onClick={() => start({ tool: 'other' })}>{T.other}</button>
              </>
            }
          />
        </div>
      )}
    </div>
  )
}
