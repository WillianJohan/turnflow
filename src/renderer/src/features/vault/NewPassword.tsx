import { useId, useState } from 'react'
import { COPY } from './copy'
import { passwordProblem, useSubmit } from './form'

/** Primeiro uso sem chaveiro de verdade: define a senha mestra. */
export function NewPassword({
  onSubmit,
  onRestore
}: {
  onSubmit: (password: string) => Promise<unknown>
  onRestore: () => void
}): React.JSX.Element {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const { busy, error, submit } = useSubmit(onSubmit)
  const problem = passwordProblem(a, b)
  // "não são iguais" só depois que a confirmação começou a ser digitada
  const hint = !a || (problem === COPY.passwordMismatch && !b) ? null : problem
  const hintId = useId()
  const aria = { 'aria-invalid': !!hint, 'aria-describedby': hint ? hintId : undefined }

  return (
    <form
      className="vault-card"
      onSubmit={(e) => {
        e.preventDefault()
        if (!problem) void submit(a)
      }}
    >
      <h1>{COPY.passwordTitle}</h1>
      <p>{COPY.passwordIntro}</p>
      <p className="vault-warn">{COPY.passwordWarning}</p>
      <label>
        {COPY.passwordNew}
        <input
          data-testid="pw-new"
          type="password"
          autoFocus
          autoComplete="new-password"
          {...aria}
          value={a}
          onChange={(e) => setA(e.target.value)}
        />
      </label>
      <label>
        {COPY.passwordConfirm}
        <input
          data-testid="pw-confirm"
          type="password"
          autoComplete="new-password"
          {...aria}
          value={b}
          onChange={(e) => setB(e.target.value)}
        />
      </label>
      <p id={hintId} className="vault-hint" aria-live="polite" hidden={!hint}>
        {hint}
      </p>
      {error && (
        <p role="alert" className="vault-error">
          {error}
        </p>
      )}
      <button data-testid="pw-submit" className="vault-primary" disabled={!!problem || busy}>
        {COPY.passwordSubmit}
      </button>
      <button type="button" data-testid="restore-link" className="vault-link" onClick={onRestore}>
        {COPY.restoreLink}
      </button>
    </form>
  )
}
