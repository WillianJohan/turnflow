import { useEffect, useRef, useState } from 'react'
import type { TaskRow } from '../../shared/contracts'
import type { UiFile } from '../../shared/uiFile'
import { homeColumns, homeLine, stalledLabel } from './homeBoard'

type Mode = UiFile['home']

type Props = {
  rows: TaskRow[]
  doneRows: TaskRow[]
  mode: Mode
  showDone: boolean
  narrow?: boolean
  onMode(mode: Mode): void
  onToggleDone(): void
  onOpen(id: string): void
}

export function HomeView({
  rows,
  doneRows,
  mode,
  showDone,
  narrow,
  onMode,
  onToggleDone,
  onOpen
}: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState(false)
  useEffect(() => {
    if (narrow !== undefined) return
    const el = host.current
    if (!el) return
    const watch = (): void => setMeasured(el.clientWidth > 0 && el.clientWidth < 560)
    watch()
    const ro = new ResizeObserver(watch)
    ro.observe(el)
    return () => ro.disconnect()
  }, [narrow])
  const tight = narrow ?? measured
  const columns = homeColumns(rows)
  return (
    <div ref={host} className={`home ${mode}`} data-narrow={tight ? '1' : '0'}>
      <div className="home-bar">
        <div role="group" aria-label="Home layout">
          <button type="button" aria-pressed={mode === 'list'} onClick={() => onMode('list')}>
            List
          </button>
          <button type="button" aria-pressed={mode === 'kanban'} onClick={() => onMode('kanban')}>
            Kanban
          </button>
        </div>
        <button type="button" aria-pressed={showDone} onClick={onToggleDone}>
          Done
        </button>
      </div>
      {showDone ? (
        <ul className="home-done">
          {doneRows.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => onOpen(row.id)}>
                {row.title}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="home-cols">
          {columns.map((col) => (
            <section key={col.id} aria-label={col.label}>
              <h3>
                {col.label} <span className="count">{col.rows.length}</span>
              </h3>
              <ul>
                {col.rows.map((row) => {
                  const line = homeLine(row, tight)
                  return (
                    <li key={row.id}>
                      <button type="button" onClick={() => onOpen(row.id)}>
                        {line.key && <span className="home-key">{line.key}</span>}
                        <span className="home-title">{line.title}</span>
                        {line.motive && <span className="home-motive">{line.motive}</span>}
                        {line.tag && <span className="home-tag">{line.tag}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {col.id === 'pendente' && stalledLabel(col.stalled) && (
                <p className="home-stalled">{stalledLabel(col.stalled)}</p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
