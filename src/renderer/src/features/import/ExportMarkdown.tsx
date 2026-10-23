import { useState } from 'react'
import { IMPORT_COPY } from '../../../../shared/copy/import'
import './import.css'

const COPY = IMPORT_COPY.export

/** Escolhe uma pasta e grava nela uma pasta nova com todas as tasks em markdown. */
export function ExportMarkdown(): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    const picked = await window.turnflow.importPickFolder()
    if (!picked.ok || !picked.data.path) return
    setBusy(true)
    setDone(null)
    setError(null)
    const r = await window.turnflow.exportMarkdown({ dest: picked.data.path })
    setBusy(false)
    if (r.ok) setDone(COPY.done(r.data.tasks, r.data.dir))
    else setError(r.error.message)
  }

  return (
    <div className="import" data-testid="export-markdown">
      <p className="import-dim">{COPY.intro}</p>
      <div className="import-row">
        <button data-testid="export-run" disabled={busy} onClick={() => void run()}>
          {busy ? COPY.exporting : COPY.button}
        </button>
      </div>
      <div aria-live="polite">{done && <p data-testid="export-done">{done}</p>}</div>
      {error && (
        <p role="alert" data-testid="export-error" className="import-error">
          {error}
        </p>
      )}
    </div>
  )
}
