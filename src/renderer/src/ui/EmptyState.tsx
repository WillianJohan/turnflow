export function EmptyState({
  title,
  children
}: {
  title: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="ui-empty">
      <p>{title}</p>
      {children}
    </div>
  )
}
