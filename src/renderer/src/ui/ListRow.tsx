export function ListRow({
  children,
  onClick
}: {
  children: React.ReactNode
  onClick?(): void
}): React.JSX.Element {
  return (
    <button type="button" className="ui-target ui-row" onClick={onClick}>
      {children}
    </button>
  )
}
