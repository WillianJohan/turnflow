import { SHELL_COPY } from '../../shared/copy/shell'
import { Icon } from './Icon'
import { NEW_ACTIONS, type NewAction } from './palette'
import { MenuList } from './ui/Menu'

const ICON: Record<NewAction, 'pencil' | 'terminal' | 'search' | 'file'> = {
  task: 'search',
  project: 'file',
  claude: 'pencil',
  terminal: 'terminal'
}

const ITEMS = NEW_ACTIONS.map((item) => ({
  id: item.id,
  label: (
    <>
      <Icon name={ICON[item.id]} size={13} /> {item.label}
    </>
  )
}))

/**
 * "+ Novo": task, projeto, Claude sem task e terminal. É o `ui/Menu` sem gatilho próprio (o "+"
 * da barra de abas e o Ctrl+Shift+N abrem): foco no primeiro item, ↑/↓ dão a volta, Home/End,
 * Esc/Tab fecham devolvendo o foco a quem abriu.
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
  return (
    <MenuList
      className={`menu newtab ${className}`}
      label={SHELL_COPY.newMenu.label}
      items={ITEMS}
      onClose={onClose}
      onPick={(id) => onPick(id as NewAction)}
    />
  )
}
