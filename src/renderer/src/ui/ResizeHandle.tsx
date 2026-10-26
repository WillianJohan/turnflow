export const RESIZE_STEP = 16

/**
 * Divisória arrastável com teclado: ←/→ andam `step` px dentro de [min, max], Home/End vão às
 * pontas. O traço é fino; a área de clique tem 24 px.
 */
export function ResizeHandle({
  label = 'Resize',
  value,
  min,
  max,
  step = RESIZE_STEP,
  onChange,
  onDrag,
  onReset,
  className = ''
}: {
  label?: string
  value: number
  min: number
  max: number
  step?: number
  onChange?(next: number): void
  onDrag?(event: React.MouseEvent<HTMLDivElement>): void
  onReset?(): void
  className?: string
}): React.JSX.Element {
  const go = (next: number): void => {
    const clamped = Math.min(max, Math.max(min, next))
    if (clamped !== value) onChange?.(clamped)
  }
  return (
    <div
      className={`ui-target ui-resize ${className}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onMouseDown={onDrag}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(value + step)
        else if (event.key === 'ArrowLeft') go(value - step)
        else if (event.key === 'Home') go(min)
        else if (event.key === 'End') go(max)
        else return
        event.preventDefault()
        event.stopPropagation()
      }}
    />
  )
}
