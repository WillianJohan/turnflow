import { useRef, useState } from 'react'
import { SHELL_COPY } from '../../shared/copy/shell'
import { Dialog } from './ui/Dialog'

const T = SHELL_COPY.project

/**
 * Nome do projeto novo. Enter cria, Esc cancela (o Dialog devolve o foco). Enquanto o IPC está no
 * ar o botão trava; erro fica no diálogo, sucesso fecha e quem chamou avisa.
 */
export function ProjectDialog({
  onCreate,
  onClose
}: {
  /** Devolve a mensagem de erro, ou `null` quando criou. */
  onCreate(name: string): Promise<string | null>
  onClose(): void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  return (
    <Dialog title={T.title} onClose={onClose}>
      <form
        className="project-form"
        onSubmit={(event) => {
          event.preventDefault()
          const clean = name.trim()
          if (!clean) {
            setError(T.required)
            return
          }
          if (running.current) return
          running.current = true
          setBusy(true)
          setError('')
          void onCreate(clean)
            .then(
              (message) => message && setError(message),
              (e: unknown) => setError(e instanceof Error ? e.message : String(e))
            )
            .finally(() => {
              running.current = false
              setBusy(false)
            })
        }}
      >
        <input
          autoFocus
          aria-label={T.name}
          value={name}
          placeholder={T.name}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setName(event.target.value)
            setError('')
          }}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="ui-dialog-actions">
          <button type="button" onClick={onClose}>
            {T.cancel}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? T.creating : T.create}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
