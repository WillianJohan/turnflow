import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function Dialog({
  title,
  onClose,
  children,
  preview = false
}: {
  title: string
  onClose(): void
  children?: React.ReactNode
  preview?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (preview) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const box = ref.current
    const target = box?.querySelector<HTMLElement>(FOCUSABLE)
    ;(target ?? box)?.focus()
    return () => previous?.focus()
  }, [preview])
  return (
    <div
      ref={ref}
      className="ui-dialog"
      role="dialog"
      aria-modal={preview ? undefined : true}
      aria-label={title}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <h3>{title}</h3>
      {children}
    </div>
  )
}
