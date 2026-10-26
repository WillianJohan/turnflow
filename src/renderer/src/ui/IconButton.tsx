import { Icon, type IconName } from '../Icon'

export function IconButton({
  icon,
  label,
  onClick
}: {
  icon: IconName
  label: string
  onClick?(): void
}): React.JSX.Element {
  return (
    <button type="button" className="ui-target ui-icon-button" aria-label={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  )
}
