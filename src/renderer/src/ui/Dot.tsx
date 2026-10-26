import type { TaskState } from '../../../shared/types'

const LABEL: Record<TaskState, string> = {
  waiting: 'esperando você',
  working: 'trabalhando',
  idle: 'parado',
  unknown: 'desconhecido'
}

export const Dot = ({ state }: { state?: TaskState }): React.JSX.Element => {
  const label = LABEL[state ?? 'idle']
  return (
    <span className={`dot ${state ?? 'idle'}`} title={label}>
      <span className="sr-only">{label}</span>
    </span>
  )
}
