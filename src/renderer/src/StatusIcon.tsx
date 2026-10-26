import { ICONS } from './iconSet'
import { parseIcon } from './statusIcon'

export function StatusIcon({
  value,
  size = 13
}: {
  value: string
  size?: number
}): React.JSX.Element | null {
  const v = parseIcon(value)
  if (v.kind === 'none') return null
  if (v.kind === 'emoji') return <span className="status-emoji">{v.value}</span>
  const C = ICONS[v.name]
  return C ? (
    <C size={size} color={v.color ?? 'currentColor'} strokeWidth={2.2} />
  ) : (
    <span className="status-emoji">?</span>
  )
}
