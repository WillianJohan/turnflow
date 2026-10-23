import { useState } from 'react'
import { COPY } from './copy'

/** O banco não abriu (migration, esquema mais novo, arquivo). */
export function Failed({
  message,
  onRetry,
  onWipe
}: {
  message: string
  /** Com promise, o botão fica desabilitado até ela terminar (um retry por vez). */
  onRetry: () => void | Promise<unknown>
  /** O texto da falha pode mandar usar Apagar tudo (banco sumiu); sem `onWipe`, o link não aparece. */
  onWipe?: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const retry = (): void => {
    const p = onRetry()
    if (!p) return
    setBusy(true)
    p.finally(() => setBusy(false)).catch(() => undefined)
  }
  return (
    <div className="vault-card">
      <h1>{COPY.failedTitle}</h1>
      <p role="alert" data-testid="failed-message" className="vault-error">
        {message}
      </p>
      <button className="vault-primary" onClick={retry} disabled={busy}>
        {COPY.retry}
      </button>
      {onWipe && (
        <button
          type="button"
          data-testid="failed-wipe-link"
          className="vault-link"
          onClick={onWipe}
        >
          {COPY.wipeTitle}
        </button>
      )}
    </div>
  )
}
