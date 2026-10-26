import { useMemo, useState } from 'react'
import type { Task } from '../../shared/types'
import { fuzzyScore } from './fuzzy'

type Props = { tasks: Task[]; onPick(id: string): void; onClose(): void }

export function Search({ tasks, onPick, onClose }: Props): React.JSX.Element {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const hits = useMemo(
    () =>
      tasks
        .map((t) => ({ t, s: fuzzyScore(q, `${t.id} ${t.title}`) }))
        .filter((h) => h.s !== null)
        .sort((a, b) => b.s! - a.s! || (a.t.dir === b.t.dir ? 0 : a.t.dir === 'current' ? -1 : 1))
        .slice(0, 20)
        .map((h) => h.t),
    [q, tasks]
  )

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, hits.length - 1))
    else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0))
    else if (e.key === 'Enter' && hits[sel]) onPick(hits[sel].id)
    else return
    e.preventDefault()
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="search"
        role="dialog"
        aria-label="Buscar task"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          placeholder="Número ou título da task…"
          onChange={(e) => {
            setQ(e.target.value)
            setSel(0)
          }}
          onKeyDown={onKey}
        />
        <ul>
          {hits.map((t, i) => (
            <li
              key={t.id}
              className={i === sel ? 'sel' : ''}
              onMouseEnter={() => setSel(i)}
              onClick={() => onPick(t.id)}
            >
              <span className="item-id">{t.id}</span>
              <span className="search-title">{t.title}</span>
              <span className="search-status">{t.bucket.name}</span>
            </li>
          ))}
          {!hits.length && <li className="empty">nada encontrado</li>}
        </ul>
      </div>
    </div>
  )
}
