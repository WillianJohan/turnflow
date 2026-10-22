import { useEffect, useRef, useState } from 'react'
import { draftPayload } from './draft'

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
    window.dk.send(id, p).then((ok) => {
      setLost(!ok)
      if (!ok) return
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
        placeholder="Draft mode: Enter quebra linha · Ctrl+Enter envia · Ctrl+Shift+D desliga"
        onChange={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
      />
      <div className="composer-bar">
        {lost && <span className="dim err">sessão encerrada — rascunho mantido</span>}
        <span className="dim">
          ✎ draft · {text.trim() ? `${text.trimEnd().split('\n').length} linha(s)` : 'vazio'}
        </span>
        <button className="primary" disabled={!text.trim()} onClick={send}>
          Enviar ⏎
        </button>
      </div>
    </div>
  )
}
