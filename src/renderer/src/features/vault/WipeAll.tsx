import { useId, useState } from 'react'
import type { WIPE_WORD } from '../../../../shared/copy/vault'
import { COPY } from './copy'
import { canWipe, useSubmit } from './form'

/**
 * Apagar tudo, com a confirmação forte (digitar APAGAR). Não pede senha: serve para quem esqueceu a
 * senha e perdeu as palavras. Depois do sucesso, o `vault.changed` leva o portão ao primeiro uso.
 */
export function WipeAll({
  onWipe,
  onBack,
  embedded = false
}: {
  /** Recebe o texto digitado; o main confere de novo (o contrato só aceita a palavra exata). */
  onWipe: (confirm: typeof WIPE_WORD) => Promise<unknown>
  onBack?: () => void
  /** Dentro de outra tela (Ajustes): sem cartão nem título próprios. */
  embedded?: boolean
}): React.JSX.Element {
  const [text, setText] = useState('')
  const { busy, error, submit } = useSubmit(onWipe)
  const warningId = useId()
  const errorId = useId()

  return (
    <form
      className={embedded ? 'vault-wipe' : 'vault-wipe vault-card'}
      onSubmit={(e) => {
        e.preventDefault()
        if (canWipe(text) && !busy) void submit(text)
      }}
    >
      {!embedded && <h1>{COPY.wipeTitle}</h1>}
      <p id={warningId} className="vault-error">
        {COPY.wipeWarning}
      </p>
      <label>
        {COPY.wipeConfirm}
        <input
          data-testid="wipe-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={error ? `${warningId} ${errorId}` : warningId}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {error && (
        <p id={errorId} role="alert" data-testid="wipe-error" className="vault-error">
          {error}
        </p>
      )}
      <button data-testid="wipe-submit" className="vault-danger" disabled={!canWipe(text) || busy}>
        {COPY.wipeSubmit}
      </button>
      {onBack && (
        <button type="button" className="vault-link" onClick={onBack}>
          {COPY.wipeBack}
        </button>
      )}
    </form>
  )
}
