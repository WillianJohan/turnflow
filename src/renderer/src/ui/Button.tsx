export function Button({
  children,
  onClick,
  type = 'button',
  primary = false
}: {
  children: React.ReactNode
  onClick?(): void
  type?: 'button' | 'submit'
  primary?: boolean
}): React.JSX.Element {
  return (
    <button
      type={type}
      className={`ui-target ui-button${primary ? ' primary' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
