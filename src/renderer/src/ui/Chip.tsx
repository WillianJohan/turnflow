export function Chip({
  children,
  pressed = false,
  onClick
}: {
  children: React.ReactNode
  pressed?: boolean
  onClick?(): void
}): React.JSX.Element {
  return (
    <button type="button" className="ui-target ui-chip" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  )
}
