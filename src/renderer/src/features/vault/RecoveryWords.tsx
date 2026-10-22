import { useState } from 'react'
import { COPY } from './copy'
import { canContinue, useSubmit } from './form'

/** As 24 palavras do primeiro uso. Nada vai ao disco até o Continuar. */
export function RecoveryWords({
  words,
  error: beginError,
  onCopy,
  onSave,
  onContinue
}: {
  words: string[] | null
  error: string | null
  onCopy: () => void
  onSave: () => Promise<string | null>
  onContinue: () => Promise<unknown>
}): React.JSX.Element {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const save = useSubmit(async () => setSavedTo(await onSave()))
  const next = useSubmit(onContinue)
  const error = beginError ?? save.error ?? next.error

  return (
    <div className="vault-card">
      <h1>{COPY.wordsTitle}</h1>
      <p>{COPY.wordsIntro}</p>
      {words ? (
        <ol data-testid="words-list" className="vault-words">
          {words.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ol>
      ) : (
        !beginError && <p className="vault-hint">{COPY.wordsLoading}</p>
      )}
      <div className="vault-row">
        <button
          data-testid="words-copy"
          disabled={!words}
          onClick={() => {
            onCopy()
            setCopied(true)
          }}
        >
          {copied ? COPY.copied : COPY.copy}
        </button>
        <button
          data-testid="words-save"
          disabled={!words || save.busy}
          onClick={() => void save.submit()}
        >
          {COPY.saveFile}
        </button>
      </div>
      {savedTo && <p className="vault-hint">{COPY.savedTo(savedTo)}</p>}
      <label className="vault-check">
        <input
          data-testid="words-saved"
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        {COPY.savedCheck}
      </label>
      {error && <p className="vault-error">{error}</p>}
      <button
        data-testid="words-continue"
        className="vault-primary"
        disabled={!canContinue(saved, words) || next.busy}
        onClick={() => void next.submit()}
      >
        {COPY.continue}
      </button>
    </div>
  )
}
