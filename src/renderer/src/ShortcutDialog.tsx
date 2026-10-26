import { useEffect, useState } from 'react'
import { SHELL_COPY } from '../../shared/copy/shell'
import { isModifierCode } from '../../shared/uiFile'
import { COMMANDS } from './commands'

type Props = {
  bindings: Record<string, string>
  onBind(id: string, code: string): void
  onClose(): void
}

export function ShortcutDialog({ bindings, onBind, onClose }: Props): React.JSX.Element {
  const [capture, setCapture] = useState<string | null>(null)

  useEffect(() => {
    if (!capture) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setCapture(null)
        return
      }
      if (!event.ctrlKey || !event.shiftKey || event.altKey) return
      event.preventDefault()
      event.stopPropagation()
      // segurar Ctrl+Shift dispara keydown do próprio modificador: espera a tecla de verdade
      if (isModifierCode(event.code)) return
      onBind(capture, event.code)
      setCapture(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capture, onBind])

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="search shortcut-dialog"
        role="dialog"
        aria-label={SHELL_COPY.shortcuts.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p>{capture ? SHELL_COPY.shortcuts.capture : SHELL_COPY.shortcuts.title}</p>
        <ul>
          {COMMANDS.map((command) => (
            <li key={command.id}>
              <button disabled={!command.enabled} onClick={() => setCapture(command.id)}>
                {command.label} <kbd>{bindings[command.id] ?? SHELL_COPY.shortcuts.unbound}</kbd>
              </button>
            </li>
          ))}
        </ul>
        <button onClick={onClose}>{SHELL_COPY.shortcuts.close}</button>
      </div>
    </div>
  )
}
