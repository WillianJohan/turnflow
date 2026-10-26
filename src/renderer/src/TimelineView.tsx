import { SHELL_COPY } from '../../shared/copy/shell'
import type { TimelineItem } from './taskFace'

const T = SHELL_COPY.timeline

export type TimelineFilter = 'all' | 'checkpoint' | 'session'

type Props = {
  items: TimelineItem[]
  onResume(id: string): void
  onNew(): void
  /** Sessão rodando: Nova sessão e Retomar saem, e entra o caminho de volta ao terminal. */
  live?: boolean
  onTerminal?(): void
  filter?: TimelineFilter
  onFilter?(filter: TimelineFilter): void
  /** Outros agentes (Codex, Cursor...) ao lado do Nova sessão. */
  extra?: React.ReactNode
}

const FILTERS: [TimelineFilter, string][] = [
  ['all', T.all],
  ['checkpoint', T.records],
  ['session', T.sessions]
]

export function TimelineView({
  items,
  onResume,
  onNew,
  live = false,
  onTerminal,
  filter = 'all',
  onFilter,
  extra
}: Props): React.JSX.Element {
  const shown = filter === 'all' ? items : items.filter((item) => item.kind === filter)
  return (
    <div className="timeline">
      <div className="timeline-actions">
        {live ? (
          <>
            <span>{T.running}</span>
            <button className="primary" onClick={onTerminal}>
              {T.toTerminal}
            </button>
          </>
        ) : (
          <>
            <button className="primary" onClick={onNew}>
              {T.newSession}
            </button>
            {extra}
          </>
        )}
      </div>
      {onFilter && (
        <div className="timeline-filter" role="group" aria-label={T.filter}>
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => onFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <ol>
        {shown.map((item) => (
          <li key={`${item.kind}:${item.id}`}>
            <span className="timeline-kind">
              {item.kind === 'checkpoint' ? T.record : T.session}
            </span>
            <span>{item.text}</span>
            {item.resumable && !live && (
              <button onClick={() => onResume(item.id)}>{T.resume}</button>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
