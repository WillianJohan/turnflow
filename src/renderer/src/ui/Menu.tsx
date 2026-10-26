import { useEffect, useRef, useState } from 'react'

export type MenuEntry = { id: string; label: React.ReactNode; disabled?: boolean }

const entries = (box: HTMLElement | null): HTMLElement[] =>
  box ? [...box.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')] : []

/**
 * Lista de um menu, com o teclado do padrão de menu: abre com foco no primeiro (ou no último)
 * item, ↑/↓ dão a volta, Home/End vão às pontas, Esc e Tab fecham, clique fora fecha. Esc e a
 * escolha devolvem o foco a `returnTo` (ou a quem tinha o foco ao abrir).
 */
export function MenuList({
  items,
  label,
  onPick,
  onClose,
  className = 'menu',
  start = 'first',
  returnTo,
  boundary,
  preview = false
}: {
  items: readonly MenuEntry[]
  label?: string
  onPick(id: string): void
  onClose(): void
  className?: string
  start?: 'first' | 'last'
  /** Quem recebe o foco ao fechar (o gatilho). Sem ele, quem tinha o foco ao abrir. */
  returnTo?: React.RefObject<HTMLElement | null>
  /** Área que não conta como "fora" (o gatilho junto da lista). */
  boundary?: React.RefObject<HTMLElement | null>
  /** Catálogo: aberto sem pegar o foco nem ouvir clique fora. */
  preview?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLUListElement>(null)
  const previous = useRef<HTMLElement | null>(null)
  const startAt = useRef(start)
  useEffect(() => {
    if (preview) return
    previous.current =
      returnTo?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const all = entries(ref.current)
    ;(startAt.current === 'last' ? all[all.length - 1] : all[0])?.focus()
    return () => {
      // a escolha pode ter levado o foco adiante (um diálogo, a paleta): só devolve se ele ficou
      // sem dono quando o menu sumiu
      const now = document.activeElement
      const lost = !now || now === document.body || !now.isConnected
      if (lost && previous.current?.isConnected) previous.current.focus()
    }
    // abre uma vez: `returnTo` é um ref estável
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview])
  useEffect(() => {
    if (preview) return
    const onDown = (event: MouseEvent): void => {
      const box = boundary?.current ?? ref.current
      if (box && !box.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [boundary, onClose, preview])
  const back = (): void => {
    if (previous.current?.isConnected) previous.current.focus()
  }
  return (
    <ul
      ref={ref}
      className={className}
      role="menu"
      aria-label={label}
      onKeyDown={(event) => {
        const all = entries(event.currentTarget)
        const i = all.indexOf(document.activeElement as HTMLElement)
        const go = (n: number): void => all[(n + all.length) % all.length]?.focus()
        if (event.key === 'ArrowDown') go(i + 1)
        else if (event.key === 'ArrowUp') go(i < 0 ? all.length - 1 : i - 1)
        else if (event.key === 'Home') go(0)
        else if (event.key === 'End') go(all.length - 1)
        else if (event.key === 'Escape') {
          onClose()
          back()
        } else if (event.key === 'Tab') {
          // o Tab segue a partir do gatilho: não previne o padrão
          onClose()
          back()
          event.stopPropagation()
          return
        } else return
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {items.map((item) => (
        <li key={item.id} role="none">
          <button
            type="button"
            role="menuitem"
            className="ui-target"
            tabIndex={-1}
            disabled={item.disabled}
            onClick={() => {
              back()
              onPick(item.id)
            }}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Botão que abre um menu. Funciona solto ou controlado (`open` + `onOpenChange`). */
export function Menu({
  label,
  ariaLabel,
  items,
  onPick,
  open,
  onOpenChange,
  preview = false
}: {
  label: React.ReactNode
  ariaLabel?: string
  items: readonly MenuEntry[]
  onPick?(id: string): void
  open?: boolean
  onOpenChange?(open: boolean): void
  preview?: boolean
}): React.JSX.Element {
  const [local, setLocal] = useState(false)
  const [start, setStart] = useState<'first' | 'last'>('first')
  const shown = open ?? local
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const set = (next: boolean): void => {
    if (open === undefined) setLocal(next)
    onOpenChange?.(next)
  }
  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="ui-target"
        aria-label={ariaLabel}
        aria-expanded={shown}
        aria-haspopup="menu"
        onClick={() => {
          setStart('first')
          set(!shown)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          event.stopPropagation()
          setStart(event.key === 'ArrowUp' ? 'last' : 'first')
          set(true)
        }}
      >
        {label}
      </button>
      {shown && (
        <MenuList
          items={items}
          label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
          start={start}
          returnTo={button}
          boundary={wrap}
          preview={preview}
          onClose={() => set(false)}
          onPick={(id) => {
            set(false)
            onPick?.(id)
          }}
        />
      )}
    </div>
  )
}
