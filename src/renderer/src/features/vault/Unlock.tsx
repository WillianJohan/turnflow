import { useId, useState } from 'react'
import { COPY } from './copy'
import { useSubmit } from './form'

/** Banco bloqueado por senha mestra. */
export function Unlock({
  onUnlock,
  onRecover,
  onForgot
}: {
  onUnlock: (password: string) => Promise<unknown>
  onRecover: () => void
  onForgot: () => void
}): React.JSX.Element {
  const [password, setPassword] = useState('')
  const { busy, error, submit } = useSubmit(onUnlock)
  const errorId = useId()

  return (
    <form
      className="vault-card"
      onSubmit={(e) => {
        e.preventDefault()
        if (password) void submit(password)
      }}
    >
      <h1>{COPY.unlockTitle}</h1>
      <label>
        {COPY.unlockPassword}
        <input
          data-testid="unlock-password"
          type="password"
          autoFocus
          autoComplete="current-password"
          aria-invalid={error !== null}
          aria-describedby={error !== null ? errorId : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error !== null && (
        <p id={errorId} role="alert" data-testid="unlock-error" className="vault-error">
          {error || COPY.wrongPassword}
        </p>
      )}
      <button data-testid="unlock-submit" className="vault-primary" disabled={!password || busy}>
        {COPY.unlockSubmit}
      </button>
      <button
        type="button"
        data-testid="unlock-recover-link"
        className="vault-link"
        onClick={onRecover}
      >
        {COPY.recoverLink}
      </button>
      <button type="button" data-testid="forgot-link" className="vault-link" onClick={onForgot}>
        {COPY.forgotLink}
      </button>
    </form>
  )
}
