import { useCallback, useEffect, useRef, useState } from 'react'
import { COPY } from './copy'
import { canContinue, CLIPBOARD_TTL_MS, useSubmit } from './form'

/**
 * As 24 palavras do primeiro uso. Nada vai ao disco até o Continuar. As palavras são a DEK: o que
 * foi copiado sai do clipboard em 60 s, no Continuar ou quando a tela some (se ainda estiver lá).
 */
export function RecoveryWords({
  words,
  error: beginError,
  onRetry,
  onCopy,
  onWipe,
  onSave,
  onContinue,
  onRestore
}: {
  words: string[] | null
  error: string | null
  onRetry: () => void
  onCopy: (text: string) => void
  onWipe: (text: string) => void
  onSave: () => Promise<string | null>
  onContinue: () => Promise<unknown>
  onRestore: () => void
}): React.JSX.Element {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const save = useSubmit(async () => setSavedTo(await onSave()))
  const next = useSubmit(onContinue)
  const error = beginError ?? save.error ?? next.error

  const inClipboard = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const wipe = useCallback((): void => {
    clearTimeout(timer.current)
    const text = inClipboard.current
    inClipboard.current = null
    if (text !== null) onWipe(text)
  }, [onWipe])
  useEffect(() => wipe, [wipe])

  const copy = (): void => {
    if (!words) return
    const text = words.join(' ')
    clearTimeout(timer.current)
    onCopy(text)
    inClipboard.current = text
    timer.current = setTimeout(wipe, CLIPBOARD_TTL_MS)
    setCopied(true)
  }

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
        <button data-testid="words-copy" disabled={!words} onClick={copy}>
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
      {error && (
        <p role="alert" className="vault-error">
          {error}
        </p>
      )}
      {beginError && (
        <button className="vault-link" onClick={onRetry}>
          {COPY.retry}
        </button>
      )}
      <button
        data-testid="words-continue"
        className="vault-primary"
        disabled={!canContinue(saved, words) || next.busy}
        onClick={() => {
          wipe()
          void next.submit()
        }}
      >
        {COPY.continue}
      </button>
      <button type="button" data-testid="restore-link" className="vault-link" onClick={onRestore}>
        {COPY.restoreLink}
      </button>
    </div>
  )
}
