import { COPY } from './copy'

/** O banco não abriu (migration, esquema mais novo, arquivo). */
export function Failed({
  message,
  onRetry
}: {
  message: string
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div className="vault-card">
      <h1>{COPY.failedTitle}</h1>
      <p data-testid="failed-message" className="vault-error">
        {message}
      </p>
      <button className="vault-primary" onClick={onRetry}>
        {COPY.retry}
      </button>
    </div>
  )
}
