import { Icon, type IconName } from '../Icon'

export function IconButton({
  icon,
  label,
  onClick,
  'aria-describedby': describedBy
}: {
  icon: IconName
  label: string
  onClick?(): void
  /** Vem do Tooltip em volta. */
  'aria-describedby'?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="ui-target ui-icon-button"
      aria-label={label}
      aria-describedby={describedBy}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  )
}
