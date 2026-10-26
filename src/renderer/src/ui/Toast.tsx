export function Toast({
  children,
  action,
  onAction
}: {
  children?: React.ReactNode
  action?: string
  onAction?(): void
}): React.JSX.Element {
  return (
    <div className="toast" role="status">
      {children}
      {action && (
        <button type="button" className="ui-target" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  )
}
