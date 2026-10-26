import { useEffect, useRef } from 'react'
import { SHELL_COPY } from '../../shared/copy/shell'
import { Icon } from './Icon'
import { NEW_ACTIONS, type NewAction } from './palette'

const ICON: Record<NewAction, 'pencil' | 'terminal' | 'search' | 'file'> = {
  task: 'search',
  project: 'file',
  claude: 'pencil',
  terminal: 'terminal'
}

/**
 * "+ Novo": task, projeto, Claude sem task e terminal. Abre com foco no primeiro item; ↑/↓ andam
 * (dando a volta), Home/End vão às pontas e Esc fecha devolvendo o foco a quem abriu.
 */
export function NewMenu({
  className = '',
  onPick,
  onClose
}: {
  className?: string
  onPick(kind: NewAction): void
  onClose(): void
}): React.JSX.Element {
  const ref = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return (
    <ul
      ref={ref}
      className={`menu newtab ${className}`}
      role="menu"
      aria-label={SHELL_COPY.newMenu.label}
      onKeyDown={(e) => {
        const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        const i = items.indexOf(document.activeElement as HTMLElement)
        const go = (n: number): void => items[(n + items.length) % items.length]?.focus()
        if (e.key === 'Escape') onClose()
        else if (e.key === 'ArrowDown') go(i + 1)
        else if (e.key === 'ArrowUp') go(i - 1)
        else if (e.key === 'Home') go(0)
        else if (e.key === 'End') go(items.length - 1)
        else if (e.key === 'Tab') onClose()
        else return
        if (e.key !== 'Tab') e.preventDefault()
        e.stopPropagation()
      }}
    >
      {NEW_ACTIONS.map((item) => (
        <li key={item.id} role="none">
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => onPick(item.id)}>
            <Icon name={ICON[item.id]} size={13} /> {item.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
