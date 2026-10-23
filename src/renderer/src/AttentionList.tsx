import { useEffect, useState } from 'react'
import type { TaskRow } from '../../shared/contracts'
import type { Density } from '../../shared/uiFile'
import { attentionFields, attentionSections } from './attentionFields'
import { Dot } from './Dot'

type Props = {
  rows: TaskRow[]
  density: Density
  now?: number
  onOpen(id: string): void
  onPeek(id: string): void
}

export function AttentionList({
  rows,
  density,
  now,
  onOpen,
  onPeek
}: Props): React.JSX.Element | null {
  const sections = attentionSections(rows)
  const flat = sections.flatMap((section) => section.rows)
  const [cursor, setCursor] = useState(0)
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    if (now !== undefined) return
    const tick = (): void => setClock(Date.now())
    tick()
    const timer = setInterval(tick, 60_000)
    return () => clearInterval(timer)
  }, [now])
  const when = now ?? clock
  if (!flat.length) return null
  const current = Math.min(cursor, flat.length - 1)
  let position = 0
  return (
    <div
      className="attn"
      role="listbox"
      aria-label="Attention"
      data-density={density}
      tabIndex={0}
      onKeyDown={(e) => {
        const options = e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')
        const move = (next: number): void => {
          setCursor(next)
          options[next]?.focus()
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          move(Math.min(flat.length - 1, current + 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          move(Math.max(0, current - 1))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          onOpen(flat[current].id)
        } else if (e.key === ' ') {
          e.preventDefault()
          onPeek(flat[current].id)
        }
      }}
    >
      {sections.map((section) => (
        <section key={section.id}>
          <h5>
            {section.label} <span className="count">{section.rows.length}</span>
          </h5>
          {section.rows.map((row) => {
            const at = position++
            const fields = attentionFields(row, density, when)
            return (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={at === current}
                tabIndex={at === current ? 0 : -1}
                className="attn-row"
                onClick={() => onOpen(row.id)}
                onFocus={() => setCursor(at)}
              >
                <Dot state={fields.state ?? undefined} />
                <span className="attn-key">{fields.key}</span>
                <span className="attn-title">{fields.title}</span>
                {fields.stage && <span className="attn-stage">{fields.stage}</span>}
                {fields.motive && <span className="attn-motive">{fields.motive}</span>}
                {fields.next && <span className="attn-next">{fields.next}</span>}
                {fields.age && <span className="attn-age">{fields.age}</span>}
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}
