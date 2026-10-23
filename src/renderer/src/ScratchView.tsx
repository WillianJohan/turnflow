import { useEffect, useRef, useState } from 'react'
import type { Live } from './App'
import { tabLabel, scratchKind } from './layout'
import { attachTerm, getTerm, hasTerm } from './terms'
import { Composer } from './Composer'
import { Icon } from './Icon'
import { orThrow } from './ipc'

type Props = {
  id: string
  live: Live
  focused: boolean
  draft: boolean
  /** `config.defaultWorkdir`: onde a aba abre (sem pasta padrão, a home). */
  workdir: string | null
  onStarted(id: string): void
  onEnd(id: string): void
}

// Aba sem task: claude solto ou terminal puro. Sobe ao montar; "Reabrir" se o processo sair.
export function ScratchView({
  id,
  live,
  focused,
  draft,
  workdir,
  onStarted,
  onEnd
}: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState('')
  const alive = live.alive.has(id)
  const exited = live.exited[id] !== undefined && !alive
  const kind = scratchKind(id)

  const start = (): void => {
    const e = getTerm(id)
    setErr('')
    orThrow(
      window.turnflow.ptySpawn(
        kind === 'shell'
          ? { kind: 'shell', pty_id: id, cols: e.term.cols, rows: e.term.rows }
          : {
              kind: 'agent',
              pty_id: id,
              tool: 'claude-code',
              task: null,
              cols: e.term.cols,
              rows: e.term.rows
            }
      )
    ).then(
      () => onStarted(id),
      (x) => setErr(String(x?.message ?? x).replace(/^Error invoking[^:]+: (Error: )?/, ''))
    )
  }

  useEffect(() => {
    if (!host.current) return
    const fresh = !hasTerm(id)
    const e = attachTerm(id, host.current)
    const ro = new ResizeObserver(() => e.fit.fit())
    ro.observe(host.current)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- aba avulsa sobe o processo ao abrir
    if (fresh && !alive) start()
    return () => {
      ro.disconnect()
      e.el.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- anexa uma vez por aba
  }, [id])

  useEffect(() => {
    if (focused && !(draft && kind === 'claude'))
      requestAnimationFrame(() => getTerm(id).term.focus())
  }, [focused, draft, id, kind])

  return (
    <div className="taskview">
      <div className="hdr">
        <div className="th">
          <Icon name={kind === 'claude' ? 'pencil' : 'terminal'} size={13} />
          <span className="th-title">
            <b>{tabLabel(id)}</b> — {kind === 'claude' ? 'Claude sem task' : 'terminal'} em{' '}
            {workdir ?? '~'}
          </span>
          <span className="th-actions">
            {alive && (
              <button onClick={() => onEnd(id)} title="Mata o processo">
                Encerrar
              </button>
            )}
          </span>
        </div>
      </div>
      {exited && (
        <div className="banner">
          Processo saiu. <button onClick={start}>Reabrir</button>
        </div>
      )}
      {err && <div className="banner error">{err}</div>}
      <div className="term" ref={host} />
      {draft && alive && kind === 'claude' && (
        <Composer id={id} focused={focused} onSent={() => undefined} />
      )}
    </div>
  )
}
