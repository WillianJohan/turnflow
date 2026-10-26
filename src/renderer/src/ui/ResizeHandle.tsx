export function ResizeHandle({
  label = 'Resize',
  onDrag
}: {
  label?: string
  onDrag?(event: React.PointerEvent<HTMLDivElement>): void
}): React.JSX.Element {
  return (
    <div
      className="ui-target ui-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={onDrag}
    />
  )
}
