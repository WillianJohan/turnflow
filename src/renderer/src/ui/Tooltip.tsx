export function Tooltip({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className="ui-target ui-tip" tabIndex={0}>
      {children}
      <span className="ui-tip-bubble" role="tooltip">
        {label}
      </span>
    </span>
  )
}
