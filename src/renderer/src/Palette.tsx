import { useState } from 'react'
import { COMMANDS, type CommandDef } from './commands'
import { cycleType, paletteItems, type PaletteItem } from './palette'

type Props = {
  tasks: { id: string; title: string }[]
  types: { id: string; name: string }[]
  projects: { id: string; name: string }[]
  commands?: CommandDef[]
  onPickTask(id: string): void
  onCreate(item: { title: string; typeId: string; projectId: string | null }): void
  onCommand(id: string): void
  onClose(): void
}

export function Palette({
  tasks,
  types,
  projects,
  commands = COMMANDS,
  onPickTask,
  onCreate,
  onCommand,
  onClose
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [typeId, setTypeId] = useState<string | undefined>(undefined)
  const [sel, setSel] = useState(0)
  const items = paletteItems({ query, tasks, types, projects, commands, typeId })
  const current = items[Math.min(sel, Math.max(items.length - 1, 0))]

  const run = (item: PaletteItem | undefined): void => {
    if (!item) return
    if (item.kind === 'create') onCreate(item)
    else if (item.kind === 'task') onPickTask(item.id)
    else onCommand(item.id)
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="search"
        role="dialog"
        aria-label="Palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          placeholder="Search, create, or > command"
          onChange={(event) => {
            setQuery(event.target.value)
            setTypeId(undefined)
            setSel(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
            else if (event.key === 'ArrowDown') setSel((i) => Math.min(i + 1, items.length - 1))
            else if (event.key === 'ArrowUp') setSel((i) => Math.max(i - 1, 0))
            else if (event.key === 'Tab' && current?.kind === 'create') {
              const next = cycleType(types, current.typeId)
              if (next) setTypeId(next)
            } else if (event.key === 'Enter') run(current)
            else return
            event.preventDefault()
          }}
        />
        <ul>
          {items.map((item, index) => (
            <li
              key={item.kind === 'create' ? 'create' : item.id}
              className={index === sel ? 'sel' : ''}
            >
              <button onMouseEnter={() => setSel(index)} onClick={() => run(item)}>
                {item.kind === 'create' && (
                  <>
                    <span>Create</span> {item.title}{' '}
                    <span className="palette-chip">{item.typeName}</span>{' '}
                    <span className="palette-chip">{item.projectName ?? 'No project'}</span>
                  </>
                )}
                {item.kind === 'task' && item.title}
                {item.kind === 'command' && item.label}
              </button>
            </li>
          ))}
          {!items.length && <li className="empty">Nothing matches</li>}
        </ul>
      </div>
    </div>
  )
}
