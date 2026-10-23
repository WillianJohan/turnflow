import type { TaskState } from '../../shared/types'

const LABEL: Record<TaskState, string> = {
  waiting: 'esperando você',
  working: 'trabalhando',
  idle: 'parado',
  unknown: 'desconhecido'
}

export const Dot = ({ state }: { state?: TaskState }): React.JSX.Element => (
  <span
    className={`dot ${state ?? 'idle'}`}
    title={LABEL[state ?? 'idle']}
    aria-label={LABEL[state ?? 'idle']}
  />
)
