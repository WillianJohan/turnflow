import { COPY } from './copy'

/** O banco não abriu (migration, esquema mais novo, arquivo). */
export function Failed({
  message,
  onRetry,
  onWipe
}: {
  message: string
  onRetry: () => void
  /** O texto da falha pode mandar usar Apagar tudo (banco sumiu); sem `onWipe`, o link não aparece. */
  onWipe?: () => void
}): React.JSX.Element {
  return (
    <div className="vault-card">
      <h1>{COPY.failedTitle}</h1>
      <p role="alert" data-testid="failed-message" className="vault-error">
        {message}
      </p>
      <button className="vault-primary" onClick={onRetry}>
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
