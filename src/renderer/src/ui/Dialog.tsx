import { useEffect, useRef, useState } from 'react'

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

const focusables = (box: HTMLElement): HTMLElement[] =>
  [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]'))

/**
 * Diálogo modal. Ao abrir, o foco vai pro primeiro controle (ou fica onde um `autoFocus` de dentro
 * o pôs); Tab e Shift+Tab dão a volta sem sair dele; Esc e clique no fundo fecham; ao fechar, o
 * foco volta a quem o tinha, a não ser que quem fechou já o tenha levado a outro lugar.
 *
 * `backdrop={false}`: sem fundo escuro (popover ancorado, como o seletor de ícone), quem usa
 * cuida do clique fora. `preview`: só a aparência, pro catálogo.
 */
export function Dialog({
  title,
  onClose,
  children,
  preview = false,
  backdrop = true,
  showTitle = true,
  className = 'ui-dialog',
  busy,
  boxRef
}: {
  title: string
  onClose(): void
  children?: React.ReactNode
  preview?: boolean
  backdrop?: boolean
  showTitle?: boolean
  className?: string
  busy?: boolean
  /** A caixa do diálogo, pra quem precisa medir ou testar clique fora. */
  boxRef?: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  // quem tinha o foco antes de abrir: lido no primeiro render, antes de um autoFocus de dentro
  const [previous] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  )
  useEffect(() => {
    if (preview) return
    const box = ref.current
    if (box && !box.contains(document.activeElement)) (focusables(box)[0] ?? box).focus()
    return () => {
      const now = document.activeElement
      const lost = !now || now === document.body || !now.isConnected || !!box?.contains(now)
      if (lost && previous?.isConnected) previous.focus()
    }
  }, [preview, previous])

  const dialog = (
    <div
      ref={(el) => {
        ref.current = el
        if (boxRef) boxRef.current = el
      }}
      className={className}
      role="dialog"
      aria-modal={preview ? undefined : true}
      aria-label={title}
      aria-busy={busy}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (preview || event.defaultPrevented) return
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
          return
        }
        if (event.key !== 'Tab') return
        const all = focusables(event.currentTarget)
        if (!all.length) {
          event.preventDefault()
          return
        }
        const first = all[0]
        const last = all[all.length - 1]
        const at = document.activeElement
        const outside = at === event.currentTarget || !all.includes(at as HTMLElement)
        if (event.shiftKey && (at === first || outside)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (at === last || outside)) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      {showTitle && <h3>{title}</h3>}
      {children}
    </div>
  )
  if (preview || !backdrop) return dialog
  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {dialog}
    </div>
  )
}
