import { useEffect, useRef, useState } from 'react'
import { SCREENS_COPY } from '../../shared/copy/screens'
import { draftPayload } from './draft'
import { sendOutcome } from './sendOutcome'

const key = (id: string): string => `turnflow.draft.${id}`
const load = (id: string): string => {
  try {
    return localStorage.getItem(key(id)) ?? ''
  } catch {
    return ''
  }
}

// Draft mode: escreve à vontade (Enter quebra linha) e só manda no Ctrl+Enter ou no botão.
export function Composer({
  id,
  focused,
  onSent
}: {
  id: string
  focused: boolean
  onSent(): void
}): React.JSX.Element {
  const [text, setText] = useState(() => load(id))
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (focused) ref.current?.focus()
  }, [focused])

  const save = (t: string): void => {
    setText(t)
    try {
      if (t) localStorage.setItem(key(id), t)
      else localStorage.removeItem(key(id))
    } catch {
      // sem storage: rascunho só não sobrevive ao reload
    }
  }

  const [lost, setLost] = useState(false)
  const send = (): void => {
    const p = draftPayload(text)
    if (!p) return
    // sessão morreu entre o render e o clique: mantém o texto
    // só um false confirmado é sessão perdida; erro de IPC mantém o texto e vai pro console
    window.turnflow.send({ id, data: p }).then((r) => {
      const out = sendOutcome(r)
      setLost(out === 'lost')
      if (!r.ok) console.error(`[ipc] ${r.error.code}: ${r.error.message}`)
      if (out !== 'sent') return
      save('')
      onSent()
    })
  }

  return (
    <div className="composer">
      <textarea
        ref={ref}
        value={text}
        rows={Math.min(12, Math.max(3, text.split('\n').length))}
        placeholder={SCREENS_COPY.composer.placeholder}
        onChange={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
      />
      <div className="composer-bar">
        {lost && <span className="dim err">{SCREENS_COPY.composer.lost}</span>}
        <span className="dim">
          {SCREENS_COPY.composer.status(text.trim() ? text.trimEnd().split('\n').length : null)}
        </span>
        <button className="primary" disabled={!text.trim()} onClick={send}>
          {SCREENS_COPY.composer.send}
        </button>
      </div>
    </div>
  )
}
