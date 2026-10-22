import { useState } from 'react'
import type { Boot } from '../../../../shared/ipc/vault'
import { COPY } from './copy'
import { passwordProblem, useSubmit } from './form'

/**
 * Desbloqueio pelas 24 palavras. Senha nova é obrigatória no modo senha; com chaveiro de verdade
 * (lock do chaveiro ou do arquivo da chave) pode ficar em branco e a chave volta para o chaveiro.
 */
export function Recover({
  boot,
  onRecover,
  onBack
}: {
  boot: Boot
  onRecover: (words: string, newPassword?: string) => Promise<unknown>
  onBack: () => void
}): React.JSX.Element {
  const [words, setWords] = useState('')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const { busy, error, submit } = useSubmit(onRecover)
  const optional = boot.backend === 'real' && boot.lock !== 'password'
  const blank = optional && !a && !b
  const problem = blank ? null : passwordProblem(a, b)
  const hint = !a || (problem === COPY.passwordMismatch && !b) ? null : problem

  return (
    <form
      className="vault-card"
      onSubmit={(e) => {
        e.preventDefault()
        if (words.trim() && !problem) void submit(words, blank ? undefined : a)
      }}
    >
      <h1>{COPY.recoverTitle}</h1>
      {boot.lock && boot.lock !== 'password' && (
        <p className="vault-warn">{COPY.lockReason[boot.lock]}</p>
      )}
      <label>
        {COPY.recoverWords}
        <textarea
          data-testid="recover-words"
          rows={4}
          autoFocus
          spellCheck={false}
          value={words}
          onChange={(e) => setWords(e.target.value)}
        />
      </label>
      <label>
        {COPY.recoverNew}
        <input
          data-testid="recover-pw-new"
          type="password"
          autoComplete="new-password"
          value={a}
          onChange={(e) => setA(e.target.value)}
        />
      </label>
      <label>
        {COPY.recoverConfirm}
        <input
          data-testid="recover-pw-confirm"
          type="password"
          autoComplete="new-password"
          value={b}
          onChange={(e) => setB(e.target.value)}
        />
      </label>
      {optional && <p className="vault-hint">{COPY.recoverOptional}</p>}
      {hint && <p className="vault-hint">{hint}</p>}
      {error && (
        <p data-testid="recover-error" className="vault-error">
          {error}
        </p>
      )}
      <button
        data-testid="recover-submit"
        className="vault-primary"
        disabled={!words.trim() || !!problem || busy}
      >
        {COPY.recoverSubmit}
      </button>
      {boot.lock === 'password' && (
        <button type="button" className="vault-link" onClick={onBack}>
          {COPY.recoverBack}
        </button>
      )}
    </form>
  )
}
