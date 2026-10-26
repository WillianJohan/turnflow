import { useId, useState } from 'react'
import type { Boot } from '../../../../shared/ipc/vault'
import { COPY } from './copy'
import { passwordProblem, useSubmit } from './form'

/**
 * Primeiro uso a partir de um backup: arquivo + 24 palavras da instalação antiga. Sem chaveiro de
 * verdade, a senha mestra nova é obrigatória. Erro não escreve nada; o portão segue em first_run.
 */
export function Restore({
  boot,
  onPick,
  onRestore,
  onBack
}: {
  boot: Boot
  onPick: () => Promise<string | null>
  onRestore: (backupPath: string, words: string, password?: string) => Promise<unknown>
  onBack: () => void
}): React.JSX.Element {
  const [path, setPath] = useState<string | null>(null)
  const [words, setWords] = useState('')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const pick = useSubmit(async () => {
    const chosen = await onPick()
    if (chosen !== null) setPath(chosen)
  })
  const restore = useSubmit(onRestore)
  const needsPassword = boot.backend === 'basic_text'
  const problem = needsPassword ? passwordProblem(a, b) : null
  const hint = !a || (problem === COPY.passwordMismatch && !b) ? null : problem
  const hintId = useId()
  const errorId = useId()
  const aria = { 'aria-invalid': !!hint, 'aria-describedby': hint ? hintId : undefined }
  const error = pick.error ?? restore.error
  const ready = path !== null && !!words.trim() && !problem

  return (
    <form
      className="vault-card"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) void restore.submit(path, words, needsPassword ? a : undefined)
      }}
    >
      <h1>{COPY.restoreTitle}</h1>
      <p>{COPY.restoreIntro}</p>
      <div className="vault-row">
        <button
          type="button"
          data-testid="restore-pick"
          disabled={pick.busy || restore.busy}
          onClick={() => void pick.submit()}
        >
          {COPY.restorePick}
        </button>
      </div>
      <p className="vault-hint" data-testid="restore-file">
        {path === null ? COPY.restoreNoFile : COPY.restoreChosen(path)}
      </p>
      <label>
        {COPY.restoreWords}
        <textarea
          data-testid="restore-words"
          rows={4}
          spellCheck={false}
          aria-invalid={!!restore.error}
          aria-describedby={error ? errorId : undefined}
          value={words}
          onChange={(e) => setWords(e.target.value)}
        />
      </label>
      {needsPassword && (
        <>
          <label>
            {COPY.restoreNew}
            <input
              data-testid="restore-pw-new"
              type="password"
              autoComplete="new-password"
              {...aria}
              value={a}
              onChange={(e) => setA(e.target.value)}
            />
          </label>
          <label>
            {COPY.restoreConfirm}
            <input
              data-testid="restore-pw-confirm"
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
        </>
      )}
      {error && (
        <p id={errorId} role="alert" data-testid="restore-error" className="vault-error">
          {error}
        </p>
      )}
      <button
        data-testid="restore-submit"
        className="vault-primary"
        disabled={!ready || restore.busy}
      >
        {COPY.restoreSubmit}
      </button>
      <button type="button" className="vault-link" onClick={onBack} disabled={restore.busy}>
        {COPY.restoreBack}
      </button>
    </form>
  )
}
